const jwt = require('jsonwebtoken');
const db = require('../config/db');
const oracledb = require('oracledb');

// LIVE OWNERS - askkin.client@gmail.com is operational owner
// ralph@ask-kin.com reserved for website launch, kept as secondary owner
const OWNER_EMAILS = [
  'askkin.client@gmail.com',
  'ralph@ask-kin.com', // reserved - will be active after website creation
  ...(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean)
].map(e=>e.toLowerCase()).filter((v,i,a)=>a.indexOf(v)===i);

function getToken(req) {
  return (req.headers.authorization || '').replace('Bearer ', '').trim();
}

async function authenticate(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'No token - please login' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(allowedRoles = []) {
  return async (req, res, next) => {
    let conn;
    try {
      const token = getToken(req);
      if (!token) return res.status(401).json({ error: 'No token' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      const email = (decoded.email || '').toLowerCase();

      // OWNER bypass - exact match only (secure)
      if (OWNER_EMAILS.includes(email)) {
        req.role = 'owner';
        req.delegateId = null;
        return next();
      }

      // Check ASKKIN.DELEGATES table
      conn = await db.getConnection();
      const result = await conn.execute(
        `SELECT ID, ROLE, IS_ACTIVE, EXPIRES_AT FROM ASKKIN.DELEGATES WHERE LOWER(EMAIL)=:email`,
        { email },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Not authorized - owner only' });
      }

      const del = result.rows[0];
      if (Number(del.IS_ACTIVE) !== 1) {
        return res.status(403).json({ error: 'Delegate revoked - contact owner' });
      }
      if (del.EXPIRES_AT && new Date(del.EXPIRES_AT) < new Date()) {
        return res.status(403).json({ error: 'Delegate expired' });
      }

      const userRole = (del.ROLE || '').toLowerCase();
      req.role = userRole;
      req.delegateId = del.ID;

      if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: `Role ${userRole} not allowed` });
      }

      next();
    } catch (e) {
      return res.status(401).json({ error: 'Auth failed' });
    } finally {
      if (conn) try { await conn.close(); } catch (_) {}
    }
  };
}

const ownerOnly = requireRole(['owner']);
const delegateOrOwner = requireRole(['owner', 'delegate']);
const anyRole = requireRole(['owner', 'delegate', 'viewer']);

module.exports = { authenticate, requireRole, ownerOnly, delegateOrOwner, anyRole, OWNER_EMAILS };

