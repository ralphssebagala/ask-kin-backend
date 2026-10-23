const axios = require('axios');
const db = require('../config/db');
const { checkNgrok, checkPesapal } = require('./healthChecks');

let lastNgrokAlertAt = 0;
let wasNgrokDown = false;

// Send WhatsApp via 3 fallbacks: Meta Cloud API -> Twilio -> Log + Email
async function sendWhatsAppAlert(message){
  const adminPhone = (process.env.SUPPORT_PHONE||'').replace('+','');
  console.log(`🚨 ALERT: ${message}`);

  // 1) Meta WhatsApp Cloud API (if you set WHATSAPP_TOKEN)
  if(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID){
    try{
      await axios.post(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        messaging_product: 'whatsapp',
        to: process.env.SUPPORT_PHONE,
        type: 'text',
        text: { body: message }
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }});
      console.log('✅ WhatsApp Cloud alert sent');
      return true;
    }catch(e){ console.error('WhatsApp Cloud failed', e.response?.data || e.message); }
  }

  // 2) Twilio (if you have it)
  if(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_WA_FROM){
    try{
      const auth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64');
      const params = new URLSearchParams();
      params.append('From', process.env.TWILIO_WA_FROM); // whatsapp:+14155238886
      params.append('To', `whatsapp:+${adminPhone}`);
      params.append('Body', message);
      await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, params, {
        headers: { Authorization: `Basic ${auth}`, 'Content-Type':'application/x-www-form-urlencoded' }
      });
      console.log('✅ Twilio WhatsApp sent');
      return true;
    }catch(e){ console.error('Twilio failed', e.response?.data || e.message); }
  }

  // 3) Fallback: Save to ADMIN_LOGS + Console (so delegate dashboard shows it)
  try{
    let conn = await db.getConnection();
    try{ await conn.execute(`BEGIN EXECUTE IMMEDIATE 'CREATE TABLE ADMIN_ALERTS (ID VARCHAR2(50) PRIMARY KEY, TYPE VARCHAR2(50), MESSAGE CLOB, CREATED_AT DATE DEFAULT SYSDATE)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE!= -955 THEN RAISE; END IF; END;`); }catch(e){}
    await conn.execute(`INSERT INTO ADMIN_ALERTS (ID, TYPE, MESSAGE) VALUES (:id,:type,:msg)`, {id:`alt_${Date.now()}`, type:'NGROK_FROZEN', msg:message}, {autoCommit:true});
    await conn.close();
  }catch(e){}
  
  // Also send email if SMTP configured
  if(process.env.SMTP_USER && process.env.SMTP_USER!=='your-email@gmail.com'){
    try{
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({ host:process.env.SMTP_HOST, port:process.env.SMTP_PORT, secure:false, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS}});
      await t.sendMail({ from: process.env.SMTP_FROM, to: process.env.ADMIN_EMAILS, subject: '🚨 Ask Kin - Ngrok Frozen', text: message });
    }catch(e){ console.error('Email alert failed', e.message); }
  }
  return false;
}

async function checkAndAlert(){
  const ngrok = await checkNgrok();
  const pesapal = await checkPesapal();
  
  if(ngrok.status === 'frozen'){
    const now = Date.now();
    // Alert only once per 30 mins to avoid spam
    if(now - lastNgrokAlertAt > 30*60*1000){
      lastNgrokAlertAt = now;
      wasNgrokDown = true;
      await sendWhatsAppAlert(
        `🚨 *Ask Kin ALERT*\n\nNgrok IPN is FROZEN!\nURL: ${ngrok.url}\nError: ${ngrok.message}\nPesapal: ${pesapal.status}\n\nDonations will FAIL until you restart ngrok.\nTime: ${new Date().toLocaleString()}\n\nFix: Run 'ngrok http 5000' and update NGROK_URL in .env`
      );
    }
  } else if(wasNgrokDown && ngrok.status === 'ok'){
    wasNgrokDown = false;
    await sendWhatsAppAlert(`✅ Ask Kin Recovered\n\nNgrok is back OK\nURL: ${ngrok.url}\nTime: ${new Date().toLocaleString()}`);
  }
}

module.exports = { checkAndAlert, sendWhatsAppAlert };