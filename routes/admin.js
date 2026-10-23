const express = require('express');
const router = express.Router();
const db = require('../config/db');
const oracledb = require('oracledb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ownerOnly } = require('../middleware/rbac');

// ================= HEALTH - public, no auth =================
router.get('/health', async (req,res)=>{
  let conn;
  try{
    let oracleStatus = { status: 'ok', message: 'Oracle DB connected' };
    try{
      conn = await db.getConnection();
      await conn.execute(`SELECT 1 FROM DUAL`);
    }catch(e){
      oracleStatus = { status: 'frozen', message: 'Oracle down: '+e.message };
    } finally { if(conn) try{await conn.close();}catch(_){} conn=null; }

    const pesapalStatus = process.env.PESAPAL_CONSUMER_KEY
  ? { status: 'ok', message: 'Pesapal key present', expiry: 'token refresh every 60m' }
     : { status: 'frozen', message: 'PESAPAL_CONSUMER_KEY missing in .env' };

    const ngrokUrl = process.env.NGROK_URL || process.env.PESAPAL_IPN_URL || '';
    const ngrokStatus = ngrokUrl.includes('ngrok') || ngrokUrl.startsWith('https')
  ? { status: 'ok', message: 'IPN URL set', url: ngrokUrl }
     : { status: 'frozen', message: 'NGROK_URL / PESAPAL_IPN_URL not set', url: ngrokUrl||'not set' };

    let payoutCount = 0;
    try{
      conn = await db.getConnection();
      const r = await conn.execute(`SELECT COUNT(*) as CNT FROM ASKKIN.CAMPAIGNS WHERE PAYOUT_MOMO_NUMBER IS NOT NULL`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
      payoutCount = r.rows[0]?.CNT || 0;
    }catch(_){} finally { if(conn) try{await conn.close();}catch(_){} }

    const health = {
      pesapal: pesapalStatus,
      oracle: oracleStatus,
      ngrok: ngrokStatus,
      payout: { status: 'ok', queue: payoutCount },
      serverTime: new Date().toISOString(),
      uptime: process.uptime()
    };
    res.json({ status: 'success', health });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

router.get('/health/delegate', async (req,res)=>{
  try{
    let conn; let oracleOk = true;
    try{ conn = await db.getConnection(); await conn.execute(`SELECT 1 FROM DUAL`); }catch(_){ oracleOk = false; } finally { if(conn) try{await conn.close();}catch(_){} }
    const hasKey =!!process.env.PESAPAL_CONSUMER_KEY;
    const hasUrl =!!(process.env.NGROK_URL || process.env.PESAPAL_IPN_URL);
    const allOk = oracleOk && hasKey && hasUrl;
    res.json({ light: allOk? 'green' : 'yellow', emoji: allOk? '🟢' : '🟡', message: allOk? 'All systems operational - Ready for Monday payout' : `Check: ${!oracleOk?'Oracle ':''}${!hasKey?'Pesapal ':''}${!hasUrl?'Ngrok ':''}`, cards: [] });
  }catch(e){ res.json({ light: 'red', emoji: '🔴', message: 'Health check failed: '+e.message }); }
});

// ========== STATS - NOW WITH DONATIONS TODAY + WEEK LIKE DELEGATE ==========
router.get('/stats', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn = await db.getConnection();
    const del = await conn.execute(`SELECT COUNT(*) as TOTAL, SUM(CASE WHEN IS_ACTIVE=1 THEN 1 ELSE 0 END) as ACTIVE FROM ASKKIN.DELEGATES`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    const camp = await conn.execute(`SELECT COUNT(*) as TOTAL FROM ASKKIN.CAMPAIGNS`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT}).catch(()=>({rows:[{TOTAL:0}]}));
    const kyc = await conn.execute(`SELECT COUNT(*) as TOTAL FROM ASKKIN.USERS WHERE KYC_STATUS='pending'`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT}).catch(()=>({rows:[{TOTAL:0}]}));

    // Donations Today - SUCCESS only, same as delegate dashboard
    let todayCount = 0, todayAmount = 0, todayBen = 0;
    let weekCount = 0, weekAmount = 0, weekBen = 0;
    try{
      const todayRes = await conn.execute(
        `SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT, NVL(SUM(BENEFICIARY_AMOUNT),0) as BEN_AMT
         FROM ASKKIN.DONATIONS
         WHERE STATUS='SUCCESS' AND TRUNC(CREATED_AT)=TRUNC(SYSDATE)`,
        {}, {outFormat: oracledb.OUT_FORMAT_OBJECT}
      );
      todayCount = todayRes.rows[0]?.CNT || 0;
      todayAmount = Number(todayRes.rows[0]?.AMT || 0);
      todayBen = Number(todayRes.rows[0]?.BEN_AMT || 0);
    }catch(e){ /* table may be DONATIONS without schema prefix */ 
      try{
        const todayRes2 = await conn.execute(
          `SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT, NVL(SUM(BENEFICIARY_AMOUNT),0) as BEN_AMT
           FROM DONATIONS WHERE STATUS='SUCCESS' AND TRUNC(CREATED_AT)=TRUNC(SYSDATE)`,
          {}, {outFormat: oracledb.OUT_FORMAT_OBJECT}
        );
        todayCount = todayRes2.rows[0]?.CNT || 0;
        todayAmount = Number(todayRes2.rows[0]?.AMT || 0);
        todayBen = Number(todayRes2.rows[0]?.BEN_AMT || 0);
      }catch(_){}
    }

    try{
      const weekRes = await conn.execute(
        `SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT, NVL(SUM(BENEFICIARY_AMOUNT),0) as BEN_AMT
         FROM ASKKIN.DONATIONS WHERE STATUS='SUCCESS' AND CREATED_AT >= SYSDATE - 7`,
        {}, {outFormat: oracledb.OUT_FORMAT_OBJECT}
      );
      weekCount = weekRes.rows[0]?.CNT || 0;
      weekAmount = Number(weekRes.rows[0]?.AMT || 0);
      weekBen = Number(weekRes.rows[0]?.BEN_AMT || 0);
    }catch(e){
      try{
        const weekRes2 = await conn.execute(
          `SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT, NVL(SUM(BENEFICIARY_AMOUNT),0) as BEN_AMT
           FROM DONATIONS WHERE STATUS='SUCCESS' AND CREATED_AT >= SYSDATE - 7`,
          {}, {outFormat: oracledb.OUT_FORMAT_OBJECT}
        );
        weekCount = weekRes2.rows[0]?.CNT || 0;
        weekAmount = Number(weekRes2.rows[0]?.AMT || 0);
        weekBen = Number(weekRes2.rows[0]?.BEN_AMT || 0);
      }catch(_){}
    }

    res.json({
      status: 'success',
      stats: {
        totalDelegates: del.rows[0].TOTAL || 0,
        activeDelegates: del.rows[0].ACTIVE || 0,
        totalCampaigns: camp.rows[0].TOTAL || 0,
        activeCampaigns: camp.rows[0].TOTAL || 0,
        pendingKyc: kyc.rows[0].TOTAL || 0,
        // Donations - matches AdminDashboard_with_donations.jsx expectations + delegate
        donationsToday: todayCount,
        donationsTodayCount: todayCount,
        todayCount,
        todayAmount,
        donationsTodayAmount: todayAmount,
        todayBenAmount: todayBen,
        donationsWeek: weekCount,
        donationsWeekCount: weekCount,
        weekCount,
        weekAmount,
        donationsWeekAmount: weekAmount,
        weekBenAmount: weekBen
      }
    });
  }catch(e){
    console.error('admin /stats error', e.message);
    res.status(500).json({error:e.message});
  }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// Explicit summary endpoint - frontend fallback
router.get('/donations/summary', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn = await db.getConnection();
    let todayCount=0, todayAmount=0, weekCount=0, weekAmount=0;
    try{
      const t = await conn.execute(`SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT FROM ASKKIN.DONATIONS WHERE STATUS='SUCCESS' AND TRUNC(CREATED_AT)=TRUNC(SYSDATE)`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
      todayCount = t.rows[0]?.CNT||0; todayAmount = Number(t.rows[0]?.AMT||0);
      const w = await conn.execute(`SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT FROM ASKKIN.DONATIONS WHERE STATUS='SUCCESS' AND CREATED_AT >= SYSDATE-7`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
      weekCount = w.rows[0]?.CNT||0; weekAmount = Number(w.rows[0]?.AMT||0);
    }catch{
      const t = await conn.execute(`SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT FROM DONATIONS WHERE STATUS='SUCCESS' AND TRUNC(CREATED_AT)=TRUNC(SYSDATE)`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
      todayCount = t.rows[0]?.CNT||0; todayAmount = Number(t.rows[0]?.AMT||0);
      const w = await conn.execute(`SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as AMT FROM DONATIONS WHERE STATUS='SUCCESS' AND CREATED_AT >= SYSDATE-7`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
      weekCount = w.rows[0]?.CNT||0; weekAmount = Number(w.rows[0]?.AMT||0);
    }
    res.json({ todayCount, todayAmount, weekCount, weekAmount });
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// ========== DELEGATES - PERMANENT ==========
router.post('/delegates', ownerOnly, async (req,res)=>{
  let conn;
  try{
    const {name,email,phone,role,password} = req.body;
    if(!name ||!email) return res.status(400).json({error:'name and email required'});
    const finalRole = (role||'delegate').toLowerCase();
    let hash = null;
    if(password) hash = await bcrypt.hash(password, 10);
    const delegateToken = jwt.sign({email: email.toLowerCase(), role: finalRole, persistent: true}, process.env.JWT_SECRET||'secret', {expiresIn: `10y`});
    conn = await db.getConnection();
    const exists = await conn.execute(`SELECT ID FROM ASKKIN.DELEGATES WHERE LOWER(EMAIL)=LOWER(:e)`, {e: email.toLowerCase()}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    if(exists.rows.length>0){
      if(hash){
        await conn.execute(`UPDATE ASKKIN.DELEGATES SET NAME=:n, PHONE=:p, ROLE=:r, IS_ACTIVE=1, EXPIRES_AT=NULL, PASSWORD_HASH=:h, CREATED_BY=:c WHERE LOWER(EMAIL)=LOWER(:e)`,
          {n: name, p: phone||null, r: finalRole, h: hash, c: req.user.email, e: email.toLowerCase()}, {autoCommit:true});
      } else {
        await conn.execute(`UPDATE ASKKIN.DELEGATES SET NAME=:n, PHONE=:p, ROLE=:r, IS_ACTIVE=1, EXPIRES_AT=NULL, CREATED_BY=:c WHERE LOWER(EMAIL)=LOWER(:e)`,
          {n: name, p: phone||null, r: finalRole, c: req.user.email, e: email.toLowerCase()}, {autoCommit:true});
      }
    } else {
      if(!hash) return res.status(400).json({error:'Password required for new delegate'});
      await conn.execute(`INSERT INTO ASKKIN.DELEGATES (ID, NAME, EMAIL, PHONE, ROLE, PASSWORD_HASH, IS_ACTIVE, EXPIRES_AT, CREATED_BY, CREATED_AT) VALUES (SYS_GUID(), :n, :e, :p, :r, :h, 1, NULL, :c, SYSTIMESTAMP)`,
        {n: name, e: email.toLowerCase(), p: phone||null, r: finalRole, h: hash, c: req.user.email}, {autoCommit:true});
    }
    const r = await conn.execute(`SELECT ID, NAME, EMAIL, PHONE, ROLE, IS_ACTIVE, EXPIRES_AT, CREATED_BY FROM ASKKIN.DELEGATES WHERE LOWER(EMAIL)=LOWER(:e)`, {e: email.toLowerCase()}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    res.json({status:'success', persistent: true, message: 'Delegate active permanently', delegate: {...r.rows[0], token: delegateToken}});
  }catch(e){ console.error('CREATE DELEGATE ERROR', e); res.status(500).json({error: e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

router.get('/delegates', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn=await db.getConnection();
    const r=await conn.execute(`SELECT ID, NAME, EMAIL, PHONE, ROLE, IS_ACTIVE, CREATED_AT, EXPIRES_AT, CREATED_BY FROM ASKKIN.DELEGATES WHERE IS_ACTIVE=1 ORDER BY CREATED_AT DESC`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    res.json({status:'success', delegates: r.rows});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

router.get('/export', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn=await db.getConnection();
    const r=await conn.execute(`SELECT NAME, EMAIL, PHONE, ROLE, IS_ACTIVE, CREATED_AT, EXPIRES_AT, CREATED_BY FROM ASKKIN.DELEGATES ORDER BY CREATED_AT DESC`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    res.json({status:'success', exportedBy: req.user.email, count: r.rows.length, delegates: r.rows});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

router.delete('/delegates/:id', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn=await db.getConnection();
    await conn.execute(`UPDATE ASKKIN.DELEGATES SET IS_ACTIVE=0 WHERE ID=:id`, {id: req.params.id}, {autoCommit:true});
    res.json({status:'success', message: 'Delegate manually revoked'});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// ========== KYC - MANUAL VERIFICATION ==========
router.get('/kyc/pending', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn = await db.getConnection();
    let rows = [];
    try{
      const r = await conn.execute(`SELECT ID, FULL_NAME, EMAIL, MOBILE_MONEY_NUMBER, MOBILE_MONEY_NAME, PROVIDER, ID_TYPE, ID_NUMBER, ID_DOC_PATH, SELFIE_PATH, KYC_STATUS FROM ASKKIN.USERS WHERE KYC_STATUS='pending'`, [], {outFormat: oracledb.OUT_FORMAT_OBJECT});
      rows = r.rows;
    }catch(e){
      try{
        const r2 = await conn.execute(`SELECT ID, FULL_NAME, EMAIL, MOBILE_MONEY_NUMBER, MOBILE_MONEY_NAME, PROVIDER, ID_TYPE, ID_NUMBER, ID_DOC_PATH, SELFIE_PATH, STATUS as KYC_STATUS FROM ASKKIN.KYC_SUBMISSIONS WHERE STATUS='pending'`, [], {outFormat: oracledb.OUT_FORMAT_OBJECT});
        rows = r2.rows;
      }catch(e2){ rows = []; }
    }
    res.json({kyc: rows});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

router.post('/kyc/:id/approve', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn = await db.getConnection();
    try{
      await conn.execute(`UPDATE ASKKIN.USERS SET KYC_STATUS='approved' WHERE ID=:id`, {id: req.params.id}, {autoCommit:true});
    }catch{
      await conn.execute(`UPDATE ASKKIN.KYC_SUBMISSIONS SET STATUS='approved' WHERE ID=:id`, {id: req.params.id}, {autoCommit:true});
    }
    res.json({status:'success'});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

router.post('/kyc/:id/reject', ownerOnly, async (req,res)=>{
  let conn;
  try{
    conn = await db.getConnection();
    try{
      await conn.execute(`UPDATE ASKKIN.USERS SET KYC_STATUS='rejected' WHERE ID=:id`, {id: req.params.id}, {autoCommit:true});
    }catch{
      await conn.execute(`UPDATE ASKKIN.KYC_SUBMISSIONS SET STATUS='rejected' WHERE ID=:id`, {id: req.params.id}, {autoCommit:true});
    }
    res.json({status:'success'});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

module.exports = router;

