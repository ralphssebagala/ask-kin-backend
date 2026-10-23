require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const cron = require('node-cron');
const path = require('path');

const db = require('./config/db');
const authRoutes = require('./routes/auth');
const campaignRoutes = require('./routes/campaigns');
const supportRoutes = require('./routes/support');
const adminRoutes = require('./routes/admin');
const donationRoutes = require('./routes/donations');
const dashboardRoutes = require('./routes/dashboard');
const delegateRoutes = require('./routes/delegate');
const teamChatRoutes = require('./routes/teamChat');
const paymentsModule = require('./routes/payments');
const assistantRoutes = require("./routes/assistant");

const app = express();
const PORT = process.env.PORT || 5000;

// ===== CORS - FINAL - UNTOUCHED =====
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With','Accept','Origin','Cache-Control','x-smile-signature','smile-signature'],
  exposedHeaders: ['Content-Range','X-Total-Count','Authorization'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(express.json({ 
  limit: '5mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function verifySmileSignature(req, res, next) {
  try {
    const signature = req.headers['x-smile-signature'] || req.headers['smile-signature'];
    const secret = process.env.SMILE_WEBHOOK_SECRET;
    if (!secret) return next();
    if (!signature) return res.status(400).json({ error: 'Missing signature' });
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (expected !== signature) console.warn('Smile signature mismatch');
    next();
  } catch (e) { next(); }
}

app.get('/', (req,res)=> res.json({ 
  status:'success', 
  message:'Ask Kin Backend Running - FINAL FIXED JS - CORS + Alias + CREATOR_ID FILTER',
  time: new Date().toISOString(),
  origin: req.headers.origin || 'no-origin'
}));

app.get('/health/cors', cors(corsOptions), (req,res)=> res.json({ 
  cors: 'ok', 
  origin: req.headers.origin || 'no-origin',
  time: new Date().toISOString()
}));

// CORE ROUTES with /api
app.use('/api/auth', authRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/payments', paymentsModule.router || paymentsModule);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/delegate', delegateRoutes);
app.use('/api/team', teamChatRoutes);

// ALIAS without /api - fixes 530 + CORS for old frontends
app.use('/auth', authRoutes);
app.use('/assistant', assistantRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/support', supportRoutes);
app.use('/donations', donationRoutes);
app.use('/payments', paymentsModule.router || paymentsModule);
app.use('/admin', adminRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/delegate', delegateRoutes);
app.use('/team', teamChatRoutes);

try { 
  const kyc = require('./routes/kyc');
  app.use('/api/kyc', kyc);
  app.use('/kyc', kyc);
} catch(e){}
try { 
  const google = require('./routes/googleAuth');
  app.use('/api/google', google);
  app.use('/google', google);
} catch(e){}
try { 
  const payouts = require('./routes/payouts');
  app.use('/api/payouts', payouts);
  app.use('/payouts', payouts);
} catch(e){}
try { app.use('/api', authRoutes); } catch(e){}
try { 
  const delegatesPlural = require('./routes/delegates');
  app.use('/api/delegates', delegatesPlural);
  app.use('/delegates', delegatesPlural);
} catch(e){}
try { 
  const dev = require('./routes/pesapalDevComplete');
  app.use('/api/dev', dev);
} catch(e){}

app.post('/smile-id-webhook', verifySmileSignature, async (req, res) => {
  console.log('Smile webhook:', req.body && req.body.event ? req.body.event : 'event', req.body && req.body.user_id ? req.body.user_id : '');
  res.status(200).json({ success: true });
});

app.use((req,res)=> res.status(404).json({ status:'error', message:'Route not found', path: req.path, method: req.method }));

app.use((err,req,res,next)=>{ 
  console.error('Global error:', err.message); 
  res.status(500).json({ status:'error', message:'Internal error' }); 
});

db.initialize().then(()=>{
  console.log('✅ Oracle pool ready - FINAL JS FIXED - NO TS SYNTAX - CREATOR_ID FILTER READY');
  app.listen(PORT, '0.0.0.0', ()=>{ 
    console.log('🚀 Server on http://0.0.0.0:' + PORT + ' - CORS OPEN + /api + non-/api aliases + creator filter');
  });
  cron.schedule('0 11 * * 1', async ()=>{
    try{ 
      const r = await paymentsModule.runMondayPayouts(); 
      console.log('[CRON Mon11am] payouts ' + r.paid + '/' + r.eligible);
    }catch(e){ console.error('[CRON]', e.message); }
  }, { timezone:'Africa/Kampala' });
}).catch(err=>{ 
  console.error('❌ Oracle failed', err.message); 
  process.exit(1); 
});

module.exports = app;
