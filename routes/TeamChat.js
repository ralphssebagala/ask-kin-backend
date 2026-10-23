const express = require('express');
const router = express.Router();
const db = require('../config/db');
const oracledb = require('oracledb');
const { anyRole } = require('../middleware/rbac');

// GET /api/team/messages?limit=50 - last 50 messages
router.get('/messages', anyRole, async (req, res) => {
  let conn;
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    conn = await db.getConnection();
    const r = await conn.execute(
      `SELECT ID, SENDER_EMAIL, SENDER_NAME, SENDER_ROLE, MESSAGE, CREATED_AT
       FROM ASKKIN.TEAM_MESSAGES
       ORDER BY CREATED_AT ASC
       FETCH FIRST :lim ROWS ONLY`,
      { lim: limit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    // Convert RAW ID to hex string for frontend key
    const msgs = r.rows.map(row => ({
      id: row.ID ? row.ID.toString('hex') : Date.now()+Math.random(),
      email: row.SENDER_EMAIL,
      name: row.SENDER_NAME || row.SENDER_EMAIL?.split('@')[0],
      role: row.SENDER_ROLE,
      message: row.MESSAGE,
      time: row.CREATED_AT
    }));
    res.json({ status: 'success', messages: msgs });
  } catch (e) {
    // Table may not exist yet - return empty instead of 500
    if (e.message && e.message.includes('ORA-00942')) {
      return res.json({ status: 'success', messages: [], note: 'Run teamChat_SQL.sql to create table' });
    }
    console.error('TEAM CHAT GET', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) try { await conn.close(); } catch (_) {}
  }
});

// POST /api/team/messages - send message
router.post('/messages', anyRole, async (req, res) => {
  let conn;
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message empty' });
    if (message.length > 1000) return res.status(400).json({ error: 'Max 1000 chars' });

    const email = (req.user.email || '').toLowerCase();
    const role = req.role || 'delegate';
    
    // Get display name from DELEGATES or USERS
    let displayName = email.split('@')[0];
    try {
      conn = await db.getConnection();
      const d = await conn.execute(
        `SELECT NAME FROM ASKKIN.DELEGATES WHERE LOWER(EMAIL)=:e`,
        { e: email },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (d.rows.length > 0) displayName = d.rows[0].NAME;
      else {
        const u = await conn.execute(
          `SELECT FULL_NAME FROM ASKKIN.USERS WHERE LOWER(EMAIL)=:e`,
          { e: email },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (u.rows.length > 0) displayName = u.rows[0].FULL_NAME;
      }
    } catch (_) {} finally { if (conn) try { await conn.close(); } catch (_) {} conn = null; }

    conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO ASKKIN.TEAM_MESSAGES (SENDER_EMAIL, SENDER_NAME, SENDER_ROLE, MESSAGE)
       VALUES (:email, :name, :role, :msg)`,
      { email, name: displayName, role, msg: message.trim().substring(0,1000) },
      { autoCommit: true }
    );

    res.json({ status: 'success', message: 'Sent' });
  } catch (e) {
    if (e.message && e.message.includes('ORA-00942')) {
      return res.status(500).json({ error: 'Team chat table not created yet. Run teamChat_SQL.sql' });
    }
    console.error('TEAM CHAT POST', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) try { await conn.close(); } catch (_) {}
  }
});

module.exports = router;
