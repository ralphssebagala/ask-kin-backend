const express = require('express');
const router = express.Router();
const db = require('../config/db');
const oracledb = require('oracledb');

// Helper: make Oracle rows JSON-safe
function toPlainRows(rows) {
  return rows.map(row => {
    const plain = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) {
        plain[k] = v;
      } else if (v instanceof Date) {
        plain[k] = v.toISOString();
      } else if (typeof v === 'bigint') {
        plain[k] = Number(v);
      } else if (typeof v === 'object' && v.constructor && (v.constructor.name === 'Lob' || v.constructor.name === 'CLOB' || v.constructor.name === 'BLOB')) {
        // Don't try to JSON LOBs - set null, fetch as string next time
        plain[k] = null;
      } else {
        plain[k] = v;
      }
    }
    return plain;
  });
}

// GET /api/campaigns?creator_id=xxx or ?email=xxx - FIXED circular JSON bug
router.get('/', async (req, res) => {
  let conn;
  try {
    const { creator_id, user_id, creatorId, email } = req.query;
    const creatorFilter = creator_id || user_id || creatorId;
    
    conn = await db.getConnection();
    // Important: fetch CLOBs as strings to avoid circular LOB objects
    oracledb.fetchAsString = [ oracledb.CLOB ];
    
    let query = `SELECT * FROM ASKKIN.CAMPAIGNS`;
    const binds = {};
    const whereClauses = [];

    if (creatorFilter) {
      whereClauses.push(`CREATOR_ID = :creatorId`);
      binds.creatorId = creatorFilter;
    }
    if (email && !creatorFilter) {
      // Resolve ID from email for fresh registrants like Juma
      try {
        const userResult = await conn.execute(
          `SELECT ID FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`,
          { email },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (userResult.rows.length > 0) {
          whereClauses.push(`CREATOR_ID = :creatorIdFromEmail`);
          binds.creatorIdFromEmail = userResult.rows[0].ID;
        } else {
          // No user found, return empty
          return res.json({ status: 'success', campaigns: [], count: 0 });
        }
      } catch (ue) {
        console.log('User lookup failed:', ue.message);
      }
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ` + whereClauses.join(' AND ');
    }
    query += ` ORDER BY CREATED_AT DESC`;

    const result = await conn.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const plain = toPlainRows(result.rows || []);
    res.json({ status: 'success', campaigns: plain, count: plain.length });
  } catch (e) {
    console.error('CAMPAIGNS GET ERROR', e.message, e.stack);
    // Never send circular error object - only message
    res.status(500).json({ status: 'error', error: e.message || 'Server error', campaigns: [] });
  } finally {
    if (conn) try { await conn.close(); } catch (_) {}
  }
});

// GET single campaign - also fixed
router.get('/:id', async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    oracledb.fetchAsString = [ oracledb.CLOB ];
    const r = await conn.execute(
      `SELECT * FROM ASKKIN.CAMPAIGNS WHERE ID = :id`,
      { id: req.params.id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const plain = toPlainRows(r.rows);
    res.json({ campaign: plain[0] });
  } catch (e) {
    console.error('CAMPAIGN GET ONE ERROR', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) try { await conn.close(); } catch (_) {}
  }
});

module.exports = router;

