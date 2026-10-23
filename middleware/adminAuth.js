const jwt = require('jsonwebtoken');
const db = require('../config/db');
const oracledb = require('oracledb');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);

async function adminAuth(req,res,next){
  try{
    const token = (req.headers.authorization||'').replace('Bearer ','');
    if(!token) return res.status(401).json({error:'No token'});
    const decoded = jwt.verify(token, process.env.JWT_SECRET||'secret');

    // Super admin check - email in ADMIN_EMAILS or first user
    const email = (decoded.email||'').toLowerCase();
    if(ADMIN_EMAILS.length>0 &&!ADMIN_EMAILS.includes(email)){
      // also allow delegate JWT
      if(!decoded.delegateId) return res.status(403).json({error:'Not admin'});
    }
    req.user = decoded;
    next();
  }catch(e){ return res.status(401).json({error:'Invalid token'}); }
}

async function delegateAuth(req,res,next){
  try{
    const token = (req.headers.authorization||'').replace('Bearer ','');
    if(!token) return res.status(401).json({error:'No token'});
    const decoded = jwt.verify(token, process.env.JWT_SECRET||'secret');
    // Check if delegate expired
    if(decoded.delegateId){
      const conn = await db.getConnection();
      const r = await conn.execute(`SELECT EXPIRES_AT, IS_ACTIVE, ROLE FROM DELEGATES WHERE ID=:id`, [decoded.delegateId], {outFormat: oracledb.OUT_FORMAT_OBJECT});
      await conn.close();
      if(r.rows.length===0 || r.rows[0].IS_ACTIVE===0) return res.status(403).json({error:'Delegate revoked'});
      if(new Date(r.rows[0].EXPIRES_AT) < new Date()) return res.status(403).json({error:'Delegate expired'});
      req.delegateRole = r.rows[0].ROLE;
    }
    req.user = decoded;
    next();
  }catch(e){ return res.status(401).json({error:'Invalid token'}); }
}

module.exports = { adminAuth, delegateAuth };