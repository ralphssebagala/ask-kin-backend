// backend/routes/googleAuth.js - FIXED FOR GOOGLE LOGIN 404
// Adds GET /google alias so /api/auth/google works

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '712171613624-fk3gotmff326fjdlpvcisb9k5hs5fo4b.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'askkin.client@gmail.com').toLowerCase();
const DELEGATE_EMAIL = (process.env.DELEGATE_EMAIL || 'amongieeve@gmail.com').toLowerCase();

const BACKEND_URL = (process.env.BACKEND_URL || 'https://api.ask-kin.com').replace(/\/$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://1c978f2f.ask-kin-client.pages.dev').replace(/\/$/, '');
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${BACKEND_URL}/api/auth/google/callback`;

console.log(`[GoogleAuth] Backend: ${BACKEND_URL}`);
console.log(`[GoogleAuth] Frontend: ${FRONTEND_URL}`);
console.log(`[GoogleAuth] Redirect URI: ${GOOGLE_REDIRECT_URI}`);

function buildGoogleUrl() {
  const redirectUri = GOOGLE_REDIRECT_URI;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid email profile')}&access_type=offline&prompt=consent`;
  return { url, redirectUri };
}

// --- FIX 1: ADD /google alias (your frontend calls this) ---
router.get('/google', (req, res) => {
  const { url, redirectUri } = buildGoogleUrl();
  if (req.query.json === '1' || req.headers.accept?.includes('application/json')) {
    return res.json({ url, redirectUri });
  }
  return res.redirect(url);
});

// Existing /google/url kept for compatibility
router.get('/google/url', (req,res) => {
  const { url, redirectUri } = buildGoogleUrl();
  if(req.query.json === '1' || req.headers.accept?.includes('application/json')){
    return res.json({ url, redirectUri });
  }
  res.redirect(url);
});

router.get('/google/callback', async (req,res) => {
  const { code, error } = req.query;
  if(error){
    console.error('[GoogleAuth] OAuth error:', error);
    return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(error)}`);
  }
  if(!code){
    return res.status(400).send('No code provided from Google');
  }
  const { redirectUri } = buildGoogleUrl();
  try {
    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    const email = p.email.toLowerCase();
    let role = 'donor';
    if(email === OWNER_EMAIL) role = 'owner';
    if(email === DELEGATE_EMAIL) role = 'delegate';
    const jwtToken = jwt.sign(
      { email, name: p.name, role, picture: p.picture, persistent: role === 'delegate' || role === 'owner' },
      process.env.JWT_SECRET || 'askkin_secret',
      { expiresIn: role === 'delegate' || role === 'owner' ? '10y' : '7d' }
    );
    let redirectPath = '/dashboard';
    if(role === 'owner') redirectPath = '/admin';
    if(role === 'delegate') redirectPath = '/delegate';
    const finalRedirect = `${FRONTEND_URL}${redirectPath}?token=${jwtToken}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(p.name)}&role=${role}`;
    console.log(`[GoogleAuth] Success: ${email} as ${role}, redirecting to ${redirectPath}`);
    res.redirect(finalRedirect);
  } catch(e){
    console.error('[GoogleAuth] Callback error:', e.message, e.stack);
    res.status(500).send(`
      <h1>Google Auth Failed</h1>
      <p>${e.message}</p>
      <p>Redirect URI used: ${redirectUri}</p>
      <p>Make sure this URI is added in Google Cloud Console -> Credentials -> Authorized redirect URIs</p>
      <a href="${FRONTEND_URL}/login">Back to login</a>
    `);
  }
});

// Keep credential flow for Google One Tap / ID token
router.post('/google', async (req,res)=>{
  try{
    const { credential } = req.body;
    if(!credential) return res.status(400).json({status:'error', message:'No credential provided'});
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    const email = p.email.toLowerCase();
    let role='donor'; 
    if(email===OWNER_EMAIL) role='owner'; 
    if(email===DELEGATE_EMAIL) role='delegate';
    const token = jwt.sign(
      { email, name:p.name, role, picture: p.picture, persistent: role !== 'donor' }, 
      process.env.JWT_SECRET||'askkin_secret', 
      {expiresIn: role !== 'donor' ? '10y' : '7d'}
    );
    res.json({
      status:'success', 
      token, 
      user:{email, name:p.name, role, picture: p.picture},
      delegate: role === 'delegate' ? { name: p.name, email, role, persistent: true } : undefined
    });
  }catch(e){ 
    console.error('[GoogleAuth] Credential error:', e.message);
    res.status(401).json({status:'error', message:e.message}); 
  }
});

module.exports = router;

