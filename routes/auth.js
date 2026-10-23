const express = require('express');
const router = express.Router();
const db = require('../config/db');
const oracledb = require('oracledb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const kycDir = path.join(__dirname, '..', 'uploads', 'kyc');
if (!fs.existsSync(kycDir)) fs.mkdirSync(kycDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, kycDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${file.fieldname}-${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// SURGICAL FIX: tries PASSWORD_HASH and PASSWORD schemas + minimalist fields
async function tryInsertUser(conn, data) {
  const schemasToTry = [
    // 1. Full KYC with PASSWORD_HASH (old prod)
    {
      sql: `INSERT INTO ASKKIN.USERS (ID, FULL_NAME, EMAIL, PASSWORD_HASH, MOBILE_MONEY_NUMBER, MOBILE_MONEY_NAME, PROVIDER, ID_TYPE, ID_NUMBER, ID_DOC_PATH, SELFIE_PATH, KYC_STATUS) VALUES (SYS_GUID(), :fullName, :email, :pass, :mmNumber, :mmName, :provider, :idType, :idNumber, :idDoc, :selfie, 'pending')`,
      binds: { fullName: data.fullName, email: data.email, pass: data.hashed, mmNumber: data.mobileMoneyNumber||null, mmName: data.mobileMoneyName||null, provider: data.provider||null, idType: data.idType||null, idNumber: data.idNumber||null, idDoc: data.idDocPath||null, selfie: data.selfiePath||null }
    },
    // 2. Full KYC with PASSWORD (your current live schema image_68820a.png)
    {
      sql: `INSERT INTO ASKKIN.USERS (ID, FULL_NAME, EMAIL, PASSWORD, MOBILE_MONEY_NUMBER, MOBILE_MONEY_NAME, PROVIDER, ID_TYPE, ID_NUMBER, ID_DOC_PATH, SELFIE_PATH, KYC_STATUS) VALUES (SYS_GUID(), :fullName, :email, :pass, :mmNumber, :mmName, :provider, :idType, :idNumber, :idDoc, :selfie, 'pending')`,
      binds: { fullName: data.fullName, email: data.email, pass: data.hashed, mmNumber: data.mobileMoneyNumber||null, mmName: data.mobileMoneyName||null, provider: data.provider||null, idType: data.idType||null, idNumber: data.idNumber||null, idDoc: data.idDocPath||null, selfie: data.selfiePath||null }
    },
    // 3. Minimalist new flow with PASSWORD column (your image_45e313.png registration)
    {
      sql: `INSERT INTO ASKKIN.USERS (ID, FULL_NAME, EMAIL, PASSWORD, PHONE, USERNAME, USERNAME_TYPE) VALUES (SYS_GUID(), :fullName, :email, :pass, :phone, :username, :usernameType)`,
      binds: { fullName: data.fullName, email: data.email, pass: data.hashed, phone: data.phone||null, username: data.email, usernameType: 'email' }
    },
    // 4. Minimalist with PASSWORD_HASH
    {
      sql: `INSERT INTO ASKKIN.USERS (ID, FULL_NAME, EMAIL, PASSWORD_HASH, PHONE, USERNAME, USERNAME_TYPE) VALUES (SYS_GUID(), :fullName, :email, :pass, :phone, :username, :usernameType)`,
      binds: { fullName: data.fullName, email: data.email, pass: data.hashed, phone: data.phone||null, username: data.email, usernameType: 'email' }
    },
    // 5. Bare minimum fallback
    {
      sql: `INSERT INTO ASKKIN.USERS (ID, FULL_NAME, EMAIL, PASSWORD) VALUES (SYS_GUID(), :fullName, :email, :pass)`,
      binds: { fullName: data.fullName, email: data.email, pass: data.hashed }
    },
    {
      sql: `INSERT INTO ASKKIN.USERS (ID, FULL_NAME, EMAIL, PASSWORD_HASH) VALUES (SYS_GUID(), :fullName, :email, :pass)`,
      binds: { fullName: data.fullName, email: data.email, pass: data.hashed }
    }
  ];

  for (let i=0; i<schemasToTry.length; i++) {
    try {
      await conn.execute(schemasToTry[i].sql, schemasToTry[i].binds, { autoCommit: true });
      console.log(`[REGISTER] Insert succeeded with schema #${i+1}`);
      return true;
    } catch (e) {
      console.log(`[REGISTER] Schema #${i+1} failed: ${e.message}`);
      // continue to next schema
    }
  }
  throw new Error('All insert schemas failed');
}

// ===== CLIENT REGISTER WITH MANUAL KYC + MINIMALIST SUPPORT =====
router.post('/register', upload.fields([{ name: 'idDocument', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]), async (req,res)=>{
  let conn;
  try{
    const body = req.body || {};
    const fullName = body.fullName || body.name || body.FULL_NAME || '';
    const email = (body.email || body.EMAIL || '').toLowerCase().trim();
    const password = body.password || body.PASSWORD || '';
    const phone = body.phone || body.PHONE || body.mobileMoneyNumber || body.MOBILE_MONEY_NUMBER || '';
    const city = body.city || body.townCity || '';
    const country = body.country || body.payoutCountry || '';
    const mobileMoneyNumber = body.mobileMoneyNumber || phone;
    const mobileMoneyName = body.mobileMoneyName || fullName;
    const provider = body.provider || 'MTN';
    const idType = body.idType || 'National ID';
    const idNumber = body.idNumber || '';

    if(!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if(!fullName) return res.status(400).json({ message: 'Full Name required' });

    const idDocPath = req.files?.idDocument?.[0]?.filename ? `/uploads/kyc/${req.files.idDocument[0].filename}` : null;
    const selfiePath = req.files?.selfie?.[0]?.filename ? `/uploads/kyc/${req.files.selfie[0].filename}` : null;

    conn = await db.getConnection();
    const exists = await conn.execute(`SELECT ID FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`, { email }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if(exists.rows.length>0) return res.status(409).json({ message: 'User already exists' });

    const hashed = await bcrypt.hash(password, 10);
    await tryInsertUser(conn, { fullName, email, hashed, phone, mobileMoneyNumber, mobileMoneyName, provider, idType, idNumber, idDocPath, selfiePath });

    const r = await conn.execute(`SELECT ID, FULL_NAME, EMAIL FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`, { email }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const u = r.rows[0];
    const token = jwt.sign({ id: u.ID, email: u.EMAIL }, process.env.JWT_SECRET, { expiresIn:'7d' });

    res.json({ status:'success', token, user:{ id:u.ID, fullName: u.FULL_NAME, email: u.EMAIL, kycStatus: 'pending', phone, city, country, idDocPath, selfiePath }});
  }catch(e){ console.error('REGISTER ERROR', e); res.status(500).json({ message: e.message }); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// ===== LOGIN (auto-detects PASSWORD vs PASSWORD_HASH) =====
router.post('/login', async (req,res)=>{
  let conn;
  try{
    const {email,password}=req.body;
    if(!email ||!password) return res.status(400).json({ error:'Email and password required' });
    conn=await db.getConnection();
    // Try PASSWORD_HASH first, then PASSWORD (your live schema)
    const queries = [
      `SELECT ID, FULL_NAME, EMAIL, PASSWORD_HASH FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`,
      `SELECT ID, FULL_NAME, EMAIL, PASSWORD FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`
    ];
    for (let q of queries) {
      try {
        const r = await conn.execute(q, { email: email.toLowerCase() }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        if(r.rows.length===0) continue;
        const u = r.rows[0];
        const hash = u.PASSWORD_HASH || u.PASSWORD;
        if(!hash) continue;
        const ok = await bcrypt.compare(password, hash);
        if(!ok) return res.status(401).json({ error:'Wrong password' });
        const token = jwt.sign({id:u.ID,email:u.EMAIL}, process.env.JWT_SECRET, {expiresIn:'7d'});
        return res.json({ status:'success', token, user:{ id:u.ID, fullName:u.FULL_NAME, email:u.EMAIL }});
      } catch (inner) {
        console.log('Login query failed, trying next:', inner.message);
        continue;
      }
    }
    return res.status(404).json({ error:'User not found' });
  }catch(e){ console.error('LOGIN ERROR', e); res.status(500).json({ error:e.message }); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// ===== DELEGATE LOGIN (unchanged) =====
router.post('/delegate/login', async (req,res)=>{
  let conn;
  try{
    const {email,password}=req.body;
    if(!email ||!password) return res.status(400).json({ error:'Email and password required' });
    conn=await db.getConnection();
    const r=await conn.execute(`SELECT ID, NAME, EMAIL, PHONE, ROLE, PASSWORD_HASH, IS_ACTIVE, EXPIRES_AT FROM ASKKIN.DELEGATES WHERE LOWER(EMAIL)=LOWER(:email)`, { email: email.toLowerCase().trim() }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if(r.rows.length===0) return res.status(404).json({ error:'No delegate account for this email. Contact owner at askkin.client@gmail.com' });
    const d=r.rows[0];
    if(Number(d.IS_ACTIVE)!==1) return res.status(403).json({ error:'Delegate revoked - contact owner' });
    if(d.EXPIRES_AT && new Date(d.EXPIRES_AT) < new Date()) return res.status(403).json({ error:'Delegate expired - contact owner' });
    if(!d.PASSWORD_HASH) return res.status(401).json({ error:'No password set - ask owner to reset' });
    const ok=await bcrypt.compare(password, d.PASSWORD_HASH);
    if(!ok) return res.status(401).json({ error:'Wrong password' });
    const token=jwt.sign({ email:d.EMAIL.toLowerCase(), role:(d.ROLE||'delegate').toLowerCase(), persistent:true, id:d.ID }, process.env.JWT_SECRET, { expiresIn:'10y' });
    res.json({ status:'success', token, delegate:{ id:d.ID, name:d.NAME, email:d.EMAIL, phone:d.PHONE, role:d.ROLE, persistent:true }});
  }catch(e){ console.error('DELEGATE LOGIN', e); res.status(500).json({ error:e.message }); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// ===== OWNER LOGIN =====
router.post('/owner/login', async (req,res)=>{
  try{
    const {email,password}=req.body;
    if(!email ||!password) return res.status(400).json({ error:'Email and password required' });
    const ownerEmail = (process.env.OWNER_EMAIL || 'askkin.client@gmail.com').toLowerCase();
    const ownerPass = process.env.OWNER_PASSWORD || 'Owner@2026';
    if(email.toLowerCase().trim() !== ownerEmail) return res.status(404).json({ error:'Not owner account - use delegate login for delegates' });
    if(password !== ownerPass) return res.status(401).json({ error:'Wrong owner password' });
    const token=jwt.sign({ email: ownerEmail, role: 'owner', id: 'owner' }, process.env.JWT_SECRET, { expiresIn:'10y' });
    return res.json({ status:'success', token, owner:{ email: ownerEmail, role:'owner' }});
  }catch(e){ console.error('OWNER LOGIN', e); res.status(500).json({ error:e.message }); }
});

module.exports=router;
