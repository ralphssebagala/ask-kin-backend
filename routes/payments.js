const express = require('express');
const router = express.Router();
const axios = require('axios');
const oracledb = require('oracledb');
const nodemailer = require('nodemailer');
const db = require('../config/db');

// Thresholds per Terms & Conditions (03 Oct 2026) - fundraiser's local currency
// Auto payout Monday 11AM EAT if >= threshold, else roll to next Monday
const THRESHOLDS = { 
  UGX: 50000,  // Uganda
  KES: 1500,   // Kenya - per Terms
  TZS: 30000,  // Tanzania - per Terms
  RWF: 15000,  // Rwanda
  ZMW: 500,    // Zambia
  BIF: 10000,
  USD: 10 
};

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, 
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function getPesapalToken() {
  const baseUrl = process.env.PESAPAL_BASE_URL || process.env.PESAPAL_BASE || 'https://cybqa.pesapal.com/pesapalv3';
  const auth = await axios.post(`${baseUrl}/api/Auth/RequestToken`, {
    consumer_key: process.env.PESAPAL_CONSUMER_KEY,
    consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
  }, { headers: { 'Content-Type': 'application/json' } });
  return { token: auth.data.token, baseUrl };
}

async function notifyDonorsOnPayout(campaignId, payoutAmount, currency, campaignTitle) {
  let conn; 
  try {
    conn = await db.getConnection();
    const donors = await conn.execute(
      `SELECT DISTINCT DONOR_EMAIL, DONOR_NAME FROM DONATIONS WHERE CAMPAIGN_ID=:cid AND STATUS IN ('SUCCESS','COMPLETED') AND DONOR_EMAIL IS NOT NULL`,
      { cid: campaignId }, 
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const transporter = getTransporter();
    if (!transporter) return;
    const fmt = new Intl.NumberFormat('en-UG').format(payoutAmount);
    for (const d of donors.rows) {
      const email = (d.DONOR_EMAIL || '').trim();
      if (!email || email.includes('test@test') || email.includes('donor@ask-kin') || !email.includes('@')) continue;
      const html = `
        <p>Hi ${d.DONOR_NAME || 'friend'},</p>
        <p>Ask Kin paid out <b>${currency} ${fmt}</b> for <b>${campaignTitle}</b> — Monday 11AM batch.</p>
        <p>Funds sent in fundraiser's local currency to ${currency} account. MoMo 2hrs / Bank 24-48hrs.</p>
        <p>Thank you for your support!</p>
        <p>— Ask Kin Team<br/>ask-kin.com</p>
      `;
      try {
        await transporter.sendMail({ 
          from: process.env.SMTP_FROM || 'support@ask-kin.com', 
          to: email, 
          subject: `Ask Kin paid out ${currency} ${fmt} for ${campaignTitle}`, 
          html 
        });
      } catch(e){ console.log('email fail', email, e.message); }
    }
  } catch (e) { 
    console.error('notify error', e.message); 
  } finally { 
    if (conn) try{ await conn.close(); }catch(_){} 
  }
}

async function disburseViaPesapal({ amount, account, campaignTitle, batchId, isBank, bankDetails }) {
  const { token, baseUrl } = await getPesapalToken();
  
  if (isBank && bankDetails) {
    console.log(`[AUTO PAYOUT Mon11am BANK] ${campaignTitle} -> ${bankDetails.bankName} ${bankDetails.accountNumber} (${bankDetails.accountName}) ${amount} ref ${batchId}`);
  } else {
    console.log(`[AUTO PAYOUT Mon11am MOMO] ${campaignTitle} -> ${account} amount ${amount} ref ${batchId}`);
  }
  
  // UNCOMMENT when licensed aggregator enables Openfloat payout API:
  // For bank: { amount, currency: 'UGX', destination_type:'BANK', bank_code, account_number, account_name, reference:batchId }
  // For MoMo: { amount, currency:'UGX', destination_type:'MOMO', destination:account, reference:batchId }
  // try {
  //   if (isBank) {
  //     await axios.post(`${baseUrl}/api/openfloat/disburse`, { 
  //       amount, 
  //       currency: 'UGX', 
  //       destination_type: 'BANK',
  //       bank_name: bankDetails.bankName,
  //       account_number: bankDetails.accountNumber,
  //       account_name: bankDetails.accountName,
  //       branch: bankDetails.branch,
  //       reference: batchId 
  //     }, { headers:{ Authorization:`Bearer ${token}` } });
  //   } else {
  //     await axios.post(`${baseUrl}/api/openfloat/disburse`, { 
  //       amount, 
  //       currency: 'UGX', 
  //       destination: account, 
  //       reference: batchId 
  //     }, { headers:{ Authorization:`Bearer ${token}` } });
  //   }
  // } catch(e){ console.error('Disburse API error', e.response?.data || e.message); throw e; }
  
  return true;
}

async function runMondayPayouts() {
  let conn;
  try {
    conn = await db.getConnection();
    // Include both MoMo and Bank fields - fundraiser chose via internal selector
    // PAYOUT_METHOD: 'MOMO' or 'BANK' - aggregator follows fundraiser's lead
    const result = await conn.execute(
      `SELECT c.ID, c.TITLE, c.CAMPAIGN_CURRENCY, 
              c.PAYOUT_MOMO_NUMBER as PAYOUT_ACCOUNT, 
              c.PAYOUT_BANK_NAME, c.PAYOUT_BANK_ACCOUNT_NAME, c.PAYOUT_BANK_ACCOUNT_NUMBER, c.PAYOUT_BANK_BRANCH, c.PAYOUT_METHOD,
              SUM(d.BENEFICIARY_AMOUNT) as TOTAL_DUE
       FROM CAMPAIGNS c 
       JOIN DONATIONS d ON d.CAMPAIGN_ID=c.ID
       WHERE d.STATUS IN ('SUCCESS','COMPLETED') 
         AND NVL(d.PAYOUT_STATUS,'PENDING')='PENDING' 
         AND (c.PAYOUT_MOMO_NUMBER IS NOT NULL OR c.PAYOUT_BANK_ACCOUNT_NUMBER IS NOT NULL)
       GROUP BY c.ID, c.TITLE, c.CAMPAIGN_CURRENCY, c.PAYOUT_MOMO_NUMBER, c.PAYOUT_BANK_NAME, c.PAYOUT_BANK_ACCOUNT_NAME, c.PAYOUT_BANK_ACCOUNT_NUMBER, c.PAYOUT_BANK_BRANCH, c.PAYOUT_METHOD
       HAVING SUM(d.BENEFICIARY_AMOUNT) >= 1000`,
      {}, 
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    
    const toPay = result.rows.filter(r => {
      const threshold = THRESHOLDS[r.CAMPAIGN_CURRENCY] || THRESHOLDS['UGX'];
      return Number(r.TOTAL_DUE) >= threshold;
    });
    
    let paid = [];
    for (const c of toPay) {
      const batchId = `mon11_${c.ID}_${Date.now()}`;
      const isBank = c.PAYOUT_BANK_ACCOUNT_NUMBER && c.PAYOUT_BANK_ACCOUNT_NUMBER.toString().trim() !== '';
      const accountDesc = isBank 
        ? `${c.PAYOUT_BANK_NAME || 'Bank'} - ${c.PAYOUT_BANK_ACCOUNT_NAME || ''} - ${c.PAYOUT_BANK_ACCOUNT_NUMBER} (${c.PAYOUT_BANK_BRANCH || ''})`
        : c.PAYOUT_ACCOUNT;
      
      try {
        await disburseViaPesapal({ 
          amount: Number(c.TOTAL_DUE), 
          account: c.PAYOUT_ACCOUNT, 
          campaignTitle: c.TITLE, 
          batchId,
          isBank,
          bankDetails: isBank ? {
            bankName: c.PAYOUT_BANK_NAME,
            accountName: c.PAYOUT_BANK_ACCOUNT_NAME,
            accountNumber: c.PAYOUT_BANK_ACCOUNT_NUMBER,
            branch: c.PAYOUT_BANK_BRANCH
          } : null
        });
        
        await conn.execute(
          `UPDATE CAMPAIGNS SET TOTAL_PAID_OUT=NVL(TOTAL_PAID_OUT,0)+:amt, PENDING_BALANCE=0, LAST_PAYOUT_DATE=SYSTIMESTAMP WHERE ID=:id`, 
          { amt: Number(c.TOTAL_DUE), id: c.ID }, 
          { autoCommit: false }
        );
        
        await conn.execute(
          `UPDATE DONATIONS SET PAYOUT_STATUS='PAID', PAYOUT_BATCH_ID=:batch, UPDATED_AT=SYSTIMESTAMP WHERE CAMPAIGN_ID=:cid AND NVL(PAYOUT_STATUS,'PENDING')='PENDING' AND STATUS IN ('SUCCESS','COMPLETED')`, 
          { batch: batchId, cid: c.ID }, 
          { autoCommit: false }
        );
        
        await conn.commit();
        await notifyDonorsOnPayout(c.ID, Number(c.TOTAL_DUE), c.CAMPAIGN_CURRENCY, c.TITLE);
        
        paid.push({ 
          id: c.ID, 
          title: c.TITLE, 
          amount: c.TOTAL_DUE, 
          currency: c.CAMPAIGN_CURRENCY,
          account: accountDesc, 
          method: isBank ? 'BANK' : 'MOMO',
          batchId 
        });
      } catch (e) { 
        await conn.rollback(); 
        console.error(`Payout failed ${c.ID}`, e.message); 
      }
    }
    
    await conn.close();
    return { eligible: toPay.length, paid: paid.length, campaigns: paid };
  } catch (e) { 
    console.error('runMondayPayouts error', e); 
    throw e; 
  }
}

// Manual trigger - protected by CRON_SECRET
router.post('/payouts/monday-run', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try { 
    const r = await runMondayPayouts(); 
    res.json({ domain:'ask-kin.com', mode:'MONDAY_11AM_AUTO', currency_note:'fundraiser_local_currency', ...r }); 
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

router.get('/payouts/pending', async (req, res) => {
  let conn; 
  try {
    conn = await db.getConnection();
    const r = await conn.execute(
      `SELECT c.ID, c.TITLE, c.CAMPAIGN_CURRENCY, c.PAYOUT_MOMO_NUMBER as PAYOUT_ACCOUNT, 
              c.PAYOUT_BANK_NAME, c.PAYOUT_BANK_ACCOUNT_NAME, c.PAYOUT_BANK_ACCOUNT_NUMBER, c.PAYOUT_METHOD,
              SUM(d.BENEFICIARY_AMOUNT) as PENDING 
       FROM CAMPAIGNS c 
       JOIN DONATIONS d ON d.CAMPAIGN_ID=c.ID 
       WHERE d.STATUS IN ('SUCCESS','COMPLETED') AND NVL(d.PAYOUT_STATUS,'PENDING')='PENDING' 
       GROUP BY c.ID, c.TITLE, c.CAMPAIGN_CURRENCY, c.PAYOUT_MOMO_NUMBER, c.PAYOUT_BANK_NAME, c.PAYOUT_BANK_ACCOUNT_NAME, c.PAYOUT_BANK_ACCOUNT_NUMBER, c.PAYOUT_METHOD`, 
      {}, 
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    await conn.close(); 
    res.json(r.rows);
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

router.get('/payouts/thresholds', (req,res)=>{
  res.json({ thresholds: THRESHOLDS, note: 'Per Terms 03 Oct 2026 - payout in fundraiser local currency, Monday 11AM EAT' });
});

module.exports = { router, runMondayPayouts, THRESHOLDS };

