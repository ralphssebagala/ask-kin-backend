require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./config/db');

const app = express();

// Middleware - rawBody needed for Smile signature
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/kyc', require('./routes/kyc'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/donations', require('./routes/donations'));
app.use('/api/payment', require('./routes/payments'));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', app: 'Ask Kin API' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ success: false, error: err.message });
});

const PORT = process.env.PORT || 5000;

db.initialize()
  .then(() => {
    console.log('✅ Oracle pool ready');
    app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Oracle init failed:', err.message);
    process.exit(1);
  });