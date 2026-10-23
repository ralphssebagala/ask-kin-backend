const express = require('express');
const router = express.Router();
const db = require('../config/db');
const oracledb = require('oracledb');

// ===== CRITICAL: /pending MUST BE BEFORE /:id =====
router.get('/pending', async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    const r = await conn.execute(
      `SELECT * FROM ASKKIN.CAMPAIGNS WHERE STATUS = 'pending' OR STATUS = 'PENDING' ORDER BY CREATED_AT DESC`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ status: 'success', campaigns: r.rows, count: r.rows.length });
  } catch (e) {
    console.error('PENDING ERROR', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) try { await conn.close(); } catch (_) {}
  }
});

// GET /api/campaigns?creator_id=xxx or ?email=xxx
router.get('/', async (req, res) => {
  let conn;
  try {
    const { creator_id, user_id, creatorId, email } = req.query;
    const creatorFilter = creator_id || user_id || creatorId;
    conn = await db.getConnection();
    let query = `SELECT * FROM ASKKIN.CAMPAIGNS`;
    const binds = {};
    const whereClauses = [];
    if (creatorFilter) {
      whereClauses.push(`CREATOR_ID = :creatorId`);
      binds.creatorId = creatorFilter;
    }
    if (email) {
      const userResult = await conn.execute(
        `SELECT ID FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`,
        { email },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (userResult.rows.length > 0) {
        whereClauses.push(`CREATOR_ID = :creatorIdFromEmail`);
        binds.creatorIdFromEmail = userResult.rows[0].ID;
      }
    }
    if (whereClauses.length > 0) {
      query += ` WHERE ` + whereClauses.join(' AND ');
    }
    query += ` ORDER BY CREATED_AT DESC`;
    const result = await conn.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.json({ status: 'success', campaigns: result.rows, count: result.rows.length });
  } catch (e) {
    console.error('CAMPAIGNS GET ERROR', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) try { await conn.close(); } catch (_) {}
  }
});

// GET single campaign
router.get('/:id', async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    const r = await conn.execute(
      `SELECT * FROM ASKKIN.CAMPAIGNS WHERE ID = :id`,
      { id: req.params.id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ campaign: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) try { await conn.close(); } catch (_) {}
  }
});

module.exports = router;