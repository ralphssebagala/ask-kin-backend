const express = require('express');
const router = express.Router();
const db = require('../config/db');
const oracledb = require('oracledb');
const jwt = require('jsonwebtoken');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);

async function authAny(req,res,next){
  const hdr = req.headers.authorization || '';
  const token = hdr.replace('Bearer ','').trim();
  if(!token) return res.status(401).json({error:'No token'});
  try{
    const d = jwt.verify(token, process.env.JWT_SECRET||'secret');
    req.user = d;
    const email = (d.email||'').toLowerCase();
    if(ADMIN_EMAILS.includes(email)){ req.user.role='owner'; return next(); }
    let c;
    try{
      c = await db.getConnection();
      const r = await c.execute(`SELECT ROLE FROM DELEGATES WHERE LOWER(EMAIL)=LOWER(:e) AND IS_ACTIVE=1 AND EXPIRES_AT > SYSTIMESTAMP`, {e: email}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
      if(r.rows.length===0) return res.status(403).json({error:'Delegate expired/inactive'});
      req.user.role = r.rows[0].ROLE;
      return next();
    }finally{ if(c) try{await c.close();}catch(_){} }
  }catch(e){ return res.status(401).json({error:'Auth failed: '+e.message}); }
}

router.get('/traffic-light', authAny, async (req,res)=>{
  let c;
  try{
    c = await db.getConnection();
    const t = await c.execute(`SELECT COUNT(*) AS C FROM DELEGATES`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    const a = await c.execute(`SELECT COUNT(*) AS C FROM DELEGATES WHERE IS_ACTIVE=1 AND EXPIRES_AT > SYSTIMESTAMP`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    const e2 = await c.execute(`SELECT COUNT(*) AS C FROM DELEGATES WHERE IS_ACTIVE=1 AND EXPIRES_AT BETWEEN SYSTIMESTAMP AND SYSTIMESTAMP + 2`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    const ex = await c.execute(`SELECT COUNT(*) AS C FROM DELEGATES WHERE EXPIRES_AT <= SYSTIMESTAMP`, {}, {outFormat: oracledb.OUT_FORMAT_OBJECT});
    let light='🟢'; let msg='Healthy - all delegates active';
    if(e2.rows[0].C>0 || ex.rows[0].C>0){ light='🟡'; msg='Attention - delegates expiring'; }
    if(a.rows[0].C===0){ light='🔴'; msg='Critical - no active delegates'; }
    res.json({status:'success', light, message: msg, user: {email:req.user.email, role:req.user.role}, stats:{total:t.rows[0].C, active:a.rows[0].C, expiringIn2Days:e2.rows[0].C, expired:ex.rows[0].C}});
  }catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(c) try{await c.close();}catch(_){} }
});

module.exports = router;