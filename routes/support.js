const express = require('express');
const router = express.Router();
const oracledb = require('oracledb');
const db = require('../config/db');
const { anyRole } = require('../middleware/rbac');

const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+256780792170';
const SUPPORT_PHONE_CLEAN = SUPPORT_PHONE.replace(/[^0-9]/g, '');

// ========== PUBLIC - NO AUTH ==========

// POST /api/support/contact-intent — keep your existing logging (call/whatsapp taps)
router.post('/contact-intent', async (req, res) => {
  const { channel, campaignId, donorEmail } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const userAgent = req.headers['user-agent'] || '';
  let conn;
  try {
    conn = await db.getConnection();
    try {
      await conn.execute(`INSERT INTO ASKKIN.SUPPORT_REQUESTS (ID, CHANNEL, CAMPAIGN_ID, DONOR_EMAIL, IP_ADDRESS, USER_AGENT, CREATED_AT)
       VALUES (SYS_GUID(), :ch, :cid, :email, :ip, :ua, SYSTIMESTAMP)`,
      { ch: channel, cid: campaignId || null, email: donorEmail || null, ip, ua: userAgent.substring(0,500) },
      { autoCommit: true });
    } catch(e){ console.log('support log skip', e.message); }
  } catch(e){}
  finally{ if(conn) try{await conn.close()}catch(_){} }
  res.json({
    ok: true,
    call: `tel:${SUPPORT_PHONE}`,
    whatsapp: `https://wa.me/${SUPPORT_PHONE_CLEAN}?text=${encodeURIComponent(`Hi Ask Kin, I need help${campaignId? ' with campaign '+campaignId : ''}`)}`
  });
});

router.get('/number', (req,res)=>{
  res.json({ masked: '+256*** ***170', whatsapp: `https://wa.me/${SUPPORT_PHONE_CLEAN}` });
});

// POST /api/support/threads - PUBLIC - visitor starts human support chat from FAQ modal
router.post('/threads', async (req, res) => {
  let conn;
  try {
    const { name, email, phone, message, campaignId } = req.body;
    if(!message || !message.trim()) return res.status(400).json({error:'Message required'});
    if(message.length > 4000) return res.status(400).json({error:'Message too long (max 4000)'});
    
    conn = await db.getConnection();
    // Create thread
    const threadResult = await conn.execute(
      `INSERT INTO ASKKIN.SUPPORT_THREADS (ID, VISITOR_NAME, VISITOR_EMAIL, VISITOR_PHONE, CAMPAIGN_ID, STATUS, LAST_MESSAGE_AT)
       VALUES (SYS_GUID(), :name, :email, :phone, :cid, 'open', SYSTIMESTAMP)
       RETURNING ID INTO :id`,
      { name: (name||'Visitor').substring(0,200), email: (email||'').substring(0,200), phone: (phone||'').substring(0,50), cid: campaignId||null, id: { dir: oracledb.BIND_OUT, type: oracledb.BUFFER, maxSize: 16 } },
      { autoCommit: false }
    );
    const threadId = threadResult.outBinds.id[0];
    
    // First message
    await conn.execute(
      `INSERT INTO ASKKIN.SUPPORT_MESSAGES (ID, THREAD_ID, SENDER_TYPE, SENDER_NAME, SENDER_EMAIL, MESSAGE)
       VALUES (SYS_GUID(), :tid, 'visitor', :sname, :semail, :msg)`,
      { tid: threadId, sname: (name||'Visitor').substring(0,200), semail: (email||'').substring(0,200), msg: message.trim().substring(0,4000) },
      { autoCommit: true }
    );

    const hexId = Buffer.from(threadId).toString('hex');
    res.json({ status:'success', threadId: hexId, message:'Support request sent - agent will reply shortly' });
  } catch(e){
    if(e.message && e.message.includes('ORA-00942')){
      return res.status(500).json({error:'Support tables not created - run support_human_SQL.sql'});
    }
    console.error('CREATE THREAD', e);
    res.status(500).json({error: e.message});
  } finally { if(conn) try{await conn.close()}catch(_){} }
});

// GET /api/support/threads/:id/messages - PUBLIC - visitor checks replies (polling)
router.get('/threads/:hexId/messages', async (req, res) => {
  let conn;
  try{
    const hex = req.params.hexId;
    if(!hex || hex.length < 16) return res.status(400).json({error:'Invalid thread id'});
    const buf = Buffer.from(hex, 'hex');
    conn = await db.getConnection();
    const r = await conn.execute(
      `SELECT ID, SENDER_TYPE, SENDER_NAME, MESSAGE, CREATED_AT FROM ASKKIN.SUPPORT_MESSAGES WHERE THREAD_ID=:tid ORDER BY CREATED_AT ASC`,
      { tid: buf },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const msgs = r.rows.map(row => ({
      id: row.ID ? Buffer.from(row.ID).toString('hex') : Math.random().toString(),
      senderType: row.SENDER_TYPE,
      name: row.SENDER_NAME,
      message: row.MESSAGE,
      time: row.CREATED_AT
    }));
    res.json({status:'success', messages: msgs});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close()}catch(_){} }
});

// POST /api/support/threads/:id/messages - PUBLIC - visitor replies
router.post('/threads/:hexId/messages', async (req, res) => {
  let conn;
  try{
    const hex = req.params.hexId;
    const { message, name, email } = req.body;
    if(!message || !message.trim()) return res.status(400).json({error:'Message empty'});
    const buf = Buffer.from(hex, 'hex');
    conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO ASKKIN.SUPPORT_MESSAGES (ID, THREAD_ID, SENDER_TYPE, SENDER_NAME, SENDER_EMAIL, MESSAGE)
       VALUES (SYS_GUID(), :tid, 'visitor', :sname, :semail, :msg)`,
      { tid: buf, sname: (name||'Visitor').substring(0,200), semail: (email||'').substring(0,200), msg: message.trim().substring(0,4000) },
      { autoCommit: false }
    );
    await conn.execute(`UPDATE ASKKIN.SUPPORT_THREADS SET LAST_MESSAGE_AT=SYSTIMESTAMP, STATUS='open' WHERE ID=:tid`, {tid: buf}, {autoCommit:true});
    res.json({status:'success'});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close()}catch(_){} }
});

// ========== PROTECTED - ADMIN + DELEGATES ==========

// GET /api/support/admin/threads - list all open threads for inbox
router.get('/admin/threads', anyRole, async (req, res) => {
  let conn;
  try{
    const status = (req.query.status || 'open').toLowerCase();
    conn = await db.getConnection();
    const r = await conn.execute(
      `SELECT ID, VISITOR_NAME, VISITOR_EMAIL, VISITOR_PHONE, CAMPAIGN_ID, STATUS, LAST_MESSAGE_AT, CREATED_AT,
              (SELECT COUNT(*) FROM ASKKIN.SUPPORT_MESSAGES WHERE THREAD_ID=T.ID) as MSG_COUNT,
              (SELECT MESSAGE FROM ASKKIN.SUPPORT_MESSAGES WHERE THREAD_ID=T.ID ORDER BY CREATED_AT DESC FETCH FIRST 1 ROW ONLY) as LAST_MSG
       FROM ASKKIN.SUPPORT_THREADS T
       WHERE STATUS=:st OR :st='all'
       ORDER BY LAST_MESSAGE_AT DESC
       FETCH FIRST 100 ROWS ONLY`,
      { st: status },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const threads = r.rows.map(row => ({
      id: Buffer.from(row.ID).toString('hex'),
      name: row.VISITOR_NAME,
      email: row.VISITOR_EMAIL,
      phone: row.VISITOR_PHONE,
      campaignId: row.CAMPAIGN_ID,
      status: row.STATUS,
      msgCount: row.MSG_COUNT,
      lastMessage: row.LAST_MSG,
      lastAt: row.LAST_MESSAGE_AT,
      createdAt: row.CREATED_AT
    }));
    res.json({status:'success', threads});
  }catch(e){
    if(e.message && e.message.includes('ORA-00942')) return res.json({status:'success', threads:[], note:'Run support_human_SQL.sql'});
    res.status(500).json({error:e.message});
  }
  finally{ if(conn) try{await conn.close()}catch(_){} }
});

// POST /api/support/admin/threads/:id/reply - admin/delegate replies
router.post('/admin/threads/:hexId/reply', anyRole, async (req, res) => {
  let conn;
  try{
    const hex = req.params.hexId;
    const { message } = req.body;
    if(!message || !message.trim()) return res.status(400).json({error:'Message empty'});
    const buf = Buffer.from(hex, 'hex');
    const email = (req.user.email || '').toLowerCase();
    const role = (req.role || req.user.role || 'admin').toLowerCase();
    let displayName = email.split('@')[0];
    try{
      conn = await db.getConnection();
      const d = await conn.execute(`SELECT NAME FROM ASKKIN.DELEGATES WHERE LOWER(EMAIL)=:e`, {e: email}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
      if(d.rows.length>0) displayName = d.rows[0].NAME;
    }catch(_){} finally{ if(conn) try{await conn.close()}catch(_){} conn=null; }
    conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO ASKKIN.SUPPORT_MESSAGES (ID, THREAD_ID, SENDER_TYPE, SENDER_NAME, SENDER_EMAIL, MESSAGE)
       VALUES (SYS_GUID(), :tid, :stype, :sname, :semail, :msg)`,
      { tid: buf, stype: role==='owner'?'admin':role, sname: displayName, semail: email, msg: message.trim().substring(0,4000) },
      { autoCommit: false }
    );
    await conn.execute(`UPDATE ASKKIN.SUPPORT_THREADS SET LAST_MESSAGE_AT=SYSTIMESTAMP, STATUS='open' WHERE ID=:tid`, {tid: buf}, {autoCommit:true});
    res.json({status:'success'});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close()}catch(_){} }
});

router.post('/admin/threads/:hexId/close', anyRole, async (req, res) => {
  let conn;
  try{
    const buf = Buffer.from(req.params.hexId, 'hex');
    conn = await db.getConnection();
    await conn.execute(`UPDATE ASKKIN.SUPPORT_THREADS SET STATUS='closed' WHERE ID=:tid`, {tid: buf}, {autoCommit:true});
    res.json({status:'success'});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) try{await conn.close()}catch(_){} }
});

module.exports = router;
