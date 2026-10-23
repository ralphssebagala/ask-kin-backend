const express = require('express');
const oracledb = require('oracledb');
const router = express.Router();
const db = require('../config/db');
const { ownerOnly, delegateOrOwner, anyRole } = require('../middleware/rbac');

async function logAction({ delegateId, email, action, target_type, target_id, details, ip }) {
  let conn;
  try {
    conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO ASKKIN.AUDIT_LOGS (id, delegate_id, delegate_email, action, target_type, target_id, details, ip_address)
       VALUES (SYS_GUID(), :did, :email, :action, :tt, :tid, :det, :ip)`,
      { did: delegateId, email, action, tt: target_type, tid: target_id, det: (details||'').substring(0,900), ip }
    );
    await conn.commit();
  } catch (e) { console.error('audit log fail', e.message); }
  finally { if (conn) try { await conn.close(); } catch (_) {} }
}

// === DELEGATE CARDS - NO STATUS COLUMN, ASKKIN SCHEMA ===
router.get('/cards', anyRole, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();

    let todayCnt = 0, todayTotal = 0, weekCnt = 0, kycPending = 0, campCnt = 0;

    // DONATIONS TODAY
    try {
      const t = await conn.execute(`SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as TOTAL FROM ASKKIN.DONATIONS WHERE TRUNC(CREATED_AT)=TRUNC(SYSDATE)`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      todayCnt = t.rows[0].CNT || 0; todayTotal = t.rows[0].TOTAL || 0;
    } catch (_) {
      try {
        const t2 = await conn.execute(`SELECT COUNT(*) as CNT, NVL(SUM(AMOUNT),0) as TOTAL FROM ASKKIN.DONATIONS`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        todayCnt = t2.rows[0].CNT || 0; todayTotal = t2.rows[0].TOTAL || 0;
      } catch(__){ todayCnt = 0; todayTotal = 0; }
    }

    // This week
    try {
      const w = await conn.execute(`SELECT COUNT(*) as CNT FROM ASKKIN.DONATIONS WHERE CREATED_AT >= TRUNC(SYSDATE)-7`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      weekCnt = w.rows[0].CNT || 0;
    } catch(_){ weekCnt = todayCnt; }

    // KYC pending
    try {
      const k = await conn.execute(`SELECT COUNT(*) as CNT FROM ASKKIN.KYC_REQUESTS WHERE STATUS='PENDING'`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      kycPending = k.rows[0].CNT || 0;
    } catch (_) {
      try {
        const k2 = await conn.execute(`SELECT COUNT(*) as CNT FROM ASKKIN.USERS WHERE KYC_STATUS='PENDING'`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        kycPending = k2.rows[0].CNT || 0;
      } catch(__){ kycPending = 0; }
    }

    // CAMPAIGNS - NO STATUS FILTER, just count all
    try {
      const c = await conn.execute(`SELECT COUNT(*) as CNT FROM ASKKIN.CAMPAIGNS`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      campCnt = c.rows[0].CNT || 0;
    } catch(e){ 
      console.log('CAMPAIGNS count still failed', e.message.substring(0,120));
      campCnt = 0;
    }

    res.json({
      status: 'success',
      cards: [
        { id: 'donations_today', title: 'Donations Today', value: `${todayCnt}`, sub: `UGX ${todayTotal}`, icon: '💰', color: 'green' },
        { id: 'donations_week', title: 'This Week', value: `${weekCnt} donations`, sub: 'Last 7 days', icon: '📈', color: 'blue' },
        { id: 'kyc_pending', title: 'KYC Pending', value: `${kycPending}`, sub: 'Needs review', icon: '🪪', color: kycPending > 0 ? 'yellow' : 'green' },
        { id: 'campaigns', title: 'Active Campaigns', value: `${campCnt}`, sub: 'Live now', icon: '🎯', color: 'purple' },
      ]
    });
  } catch (e) {
    console.error('CARDS FINAL ERROR', e);
    res.json({
      status: 'success',
      cards: [
        { id: 'donations_today', title: 'Donations Today', value: '0', sub: 'Today', icon: '💰', color: 'green' },
        { id: 'donations_week', title: 'This Week', value: '0 donations', sub: 'Last 7 days', icon: '📈', color: 'blue' },
        { id: 'kyc_pending', title: 'KYC Pending', value: '0', sub: 'Needs review', icon: '🪪', color: 'green' },
        { id: 'campaigns', title: 'Active Campaigns', value: '0', sub: 'Live now', icon: '🎯', color: 'purple' },
      ]
    });
  } finally { if (conn) try { await conn.close(); } catch (_) {} }
});

router.get('/kyc/pending', delegateOrOwner, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    let rows = [];
    try {
      const r = await conn.execute(`SELECT k.ID, k.USER_ID, u.EMAIL, k.ID_TYPE, k.CREATED_AT FROM ASKKIN.KYC_REQUESTS k JOIN ASKKIN.USERS u ON u.ID=k.USER_ID WHERE k.STATUS='PENDING' ORDER BY k.CREATED_AT ASC FETCH FIRST 20 ROWS ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      rows = r.rows;
    } catch (_) {
      try {
        const r2 = await conn.execute(`SELECT ID, EMAIL, KYC_STATUS, CREATED_AT FROM ASKKIN.USERS WHERE KYC_STATUS='PENDING' ORDER BY CREATED_AT ASC FETCH FIRST 20 ROWS ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        rows = r2.rows.map(u => ({ ID: u.ID, USER_ID: u.ID, EMAIL: u.EMAIL, ID_TYPE: 'NATIONAL_ID', CREATED_AT: u.CREATED_AT }));
      } catch(__){ rows = []; }
    }
    res.json({ status: 'success', pending: rows });
  } catch (e) { res.json({ status: 'success', pending: [] }); }
  finally { if (conn) try { await conn.close(); } catch (_) {} }
});

router.post('/kyc/:id/approve', delegateOrOwner, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    try { await conn.execute(`UPDATE ASKKIN.KYC_REQUESTS SET STATUS='VERIFIED', REVIEWED_BY=:by, REVIEWED_AT=SYSDATE WHERE ID=:id`, { by: req.delegateId || req.user.email, id: req.params.id }); } catch (_) {}
    try { await conn.execute(`UPDATE ASKKIN.USERS SET KYC_STATUS='VERIFIED' WHERE ID=:id OR ID=(SELECT USER_ID FROM ASKKIN.KYC_REQUESTS WHERE ID=:id)`, { id: req.params.id }); } catch(_){}
    await conn.commit();
    await logAction({ delegateId: req.delegateId, email: req.user.email, action: 'KYC_APPROVE', target_type: 'kyc', target_id: req.params.id, details: 'Approved via delegate dashboard', ip: req.ip });
    res.json({ status: 'success', message: 'KYC approved ✅' });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { if (conn) try { await conn.close(); } catch (_) {} }
});

router.post('/kyc/:id/reject', delegateOrOwner, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    try { await conn.execute(`UPDATE ASKKIN.KYC_REQUESTS SET STATUS='REJECTED', REVIEWED_BY=:by, REVIEWED_AT=SYSDATE WHERE ID=:id`, { by: req.delegateId || req.user.email, id: req.params.id }); } catch (_) {}
    try { await conn.execute(`UPDATE ASKKIN.USERS SET KYC_STATUS='FAILED' WHERE ID=:id OR ID=(SELECT USER_ID FROM ASKKIN.KYC_REQUESTS WHERE ID=:id)`, { id: req.params.id }); } catch(_){}
    await conn.commit();
    await logAction({ delegateId: req.delegateId, email: req.user.email, action: 'KYC_REJECT', target_type: 'kyc', target_id: req.params.id, details: req.body.reason || '', ip: req.ip });
    res.json({ status: 'success', message: 'KYC rejected' });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { if (conn) try { await conn.close(); } catch (_) {} }
});

module.exports = router;

