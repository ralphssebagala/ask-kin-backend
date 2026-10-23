const express = require('express');
const router = express.Router();
const db = require('../config/db');
const oracledb = require('oracledb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload dir exists
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

// Helper to try extended columns, fallback to basic
async function tryInsertUser(conn, data) {
  // Try full KYC schema first
  try {
    await conn.execute(`
      INSERT INTO ASKKIN.USERS 
      (ID, FULL_NAME, EMAIL, PASSWORD_HASH, MOBILE_MONEY_NUMBER, MOBILE_MONEY_NAME, PROVIDER, ID_TYPE, ID_NUMBER, ID_DOC_PATH, SELFIE_PATH, KYC_STATUS)
      VALUES (SYS_GUID(), :fullName, :email, :pass, :mmNumber, :mmName, :provider, :idType, :idNumber, :idDoc, :selfie, 'pending')
    `, {
      fullName: data.fullName,
      email: data.email,
      pass: data.hashed,
      mmNumber: data.mobileMoneyNumber || null,
      mmName: data.mobileMoneyName || null,
      provider: data.provider || null,
      idType: data.idType || null,
      idNumber: data.idNumber || null,
      idDoc: data.idDocPath || null,
      selfie: data.selfiePath || null
    }, { autoCommit: true });
    return true;
  } catch (e) {
    console.log('Full KYC insert failed, trying basic + KYC table', e.message);
    // Basic user insert
    await conn.execute(`INSERT INTO ASKKIN.USERS (ID, FULL_NAME, EMAIL, PASSWORD_HASH) VALUES (SYS_GUID(), :name, :email, :pass)`, 
      { name: data.fullName, email: data.email, pass: data.hashed }, { autoCommit: true });
    
    // Try to insert into KYC table if exists, else ignore
    try {
      await conn.execute(`
        INSERT INTO ASKKIN.KYC_SUBMISSIONS (ID, EMAIL, FULL_NAME, MOBILE_MONEY_NUMBER, MOBILE_MONEY_NAME, PROVIDER, ID_TYPE, ID_NUMBER, ID_DOC_PATH, SELFIE_PATH, STATUS)
        VALUES (SYS_GUID(), :email, :fullName, :mmNumber, :mmName, :provider, :idType, :idNumber, :idDoc, :selfie, 'pending')
      `, {
        email: data.email,
        fullName: data.fullName,
        mmNumber: data.mobileMoneyNumber,
        mmName: data.mobileMoneyName,
        provider: data.provider,
        idType: data.idType,
        idNumber: data.idNumber,
        idDoc: data.idDocPath,
        selfie: data.selfiePath
      }, { autoCommit: true });
    } catch (kycErr) {
      console.log('KYC table also missing, saving only basic user. Create table later:', kycErr.message);
    }
    return false;
  }
}

// ===== CLIENT REGISTER WITH MANUAL KYC =====
router.post('/register', upload.fields([{ name: 'idDocument', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]), async (req,res)=>{
  let conn;
  try{
    // Support both JSON and FormData
    const body = req.body || {};
    const fullName = body.fullName || body.name || '';
    const email = (body.email || '').toLowerCase().trim();
    const password = body.password || '';
    const mobileMoneyNumber = body.mobileMoneyNumber || '';
    const mobileMoneyName = body.mobileMoneyName || '';
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
    await tryInsertUser(conn, { fullName, email, hashed, mobileMoneyNumber, mobileMoneyName, provider, idType, idNumber, idDocPath, selfiePath });

    const r = await conn.execute(`SELECT ID, FULL_NAME, EMAIL FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`, { email }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const u = r.rows[0];
    const token = jwt.sign({ id: u.ID, email: u.EMAIL }, process.env.JWT_SECRET, { expiresIn:'7d' });

    res.json({ status:'success', token, user:{ id:u.ID, fullName: u.FULL_NAME, email: u.EMAIL, kycStatus: 'pending', idDocPath, selfiePath }});
  }catch(e){ console.error('REGISTER KYC', e); res.status(500).json({ message: e.message }); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// ===== LOGIN (donors + clients) =====
router.post('/login', async (req,res)=>{
  let conn;
  try{
    const {email,password}=req.body;
    if(!email ||!password) return res.status(400).json({ error:'Email and password required' });
    conn=await db.getConnection();
    let r;
    try {
      r=await conn.execute(`SELECT ID, FULL_NAME, EMAIL, PASSWORD_HASH FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`, { email: email.toLowerCase() }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if(r.rows.length===0) throw new Error('not found');
      const u=r.rows[0];
      const ok=await bcrypt.compare(password, u.PASSWORD_HASH);
      if(!ok) return res.status(401).json({ error:'Wrong password' });
      const token=jwt.sign({id:u.ID,email:u.EMAIL}, process.env.JWT_SECRET, {expiresIn:'7d'});
      return res.json({ status:'success', token, user:{ id:u.ID, fullName:u.FULL_NAME, email:u.EMAIL }});
    } catch(_){
      r=await conn.execute(`SELECT ID, FULL_NAME, EMAIL, PASSWORD FROM ASKKIN.USERS WHERE LOWER(EMAIL)=LOWER(:email)`, { email: email.toLowerCase() }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if(r.rows.length===0) return res.status(404).json({ error:'User not found' });
      const u=r.rows[0];
      const ok=await bcrypt.compare(password, u.PASSWORD);
      if(!ok) return res.status(401).json({ error:'Wrong password' });
      const token=jwt.sign({id:u.ID,email:u.EMAIL}, process.env.JWT_SECRET, {expiresIn:'7d'});
      return res.json({ status:'success', token, user:{ id:u.ID, fullName:u.FULL_NAME, email:u.EMAIL }});
    }
  }catch(e){ console.error('LOGIN ERROR', e); res.status(500).json({ error:e.message }); }
  finally{ if(conn) try{await conn.close();}catch(_){} }
});

// ===== DELEGATE LOGIN =====
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


// ===== OWNER LOGIN - NOT A DELEGATE, NEVER REVOKABLE =====
router.post('/owner/login', async (req,res)=>{
  try{
    const {email,password}=req.body;
    if(!email ||!password) return res.status(400).json({ error:'Email and password required' });
    const ownerEmail = (process.env.OWNER_EMAIL || 'askkin.client@gmail.com').toLowerCase();
    const ownerPass = process.env.OWNER_PASSWORD || 'Owner@2026';
    // Allow both env and fallback, case-insensitive email, exact password
    if(email.toLowerCase().trim() !== ownerEmail){
      return res.status(404).json({ error:'Not owner account - use delegate login for delegates' });
    }
    if(password !== ownerPass){
      return res.status(401).json({ error:'Wrong owner password' });
    }
    const token=jwt.sign({ email: ownerEmail, role: 'owner', id: 'owner' }, process.env.JWT_SECRET, { expiresIn:'10y' });
    return res.json({ status:'success', token, owner:{ email: ownerEmail, role:'owner' }});
  }catch(e){ console.error('OWNER LOGIN', e); res.status(500).json({ error:e.message }); }
});


module.exports=router;


