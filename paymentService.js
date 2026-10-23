const axios = require('axios');

const PESAPAL_BASE = process.env.PESAPAL_BASE_URL || 'https://cybqa.pesapal.com/pesapalv3';
let cachedToken = null;
let cachedExpiry = 0;

// Normalize 07... +257... 257... -> 257..., 256...
function normalizePhone(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[\s\-\(\)]/g, '').replace(/^\+/, '').trim();
  if (p.startsWith('0')) p = p.substring(1);
  if (/^(256|254|255|250|257)\d{8,9}$/.test(p)) return p;
  if (/^7\d{8}$/.test(p)) return '256' + p;
  return p;
}

// FIX for Pesapal 500: country_code must match currency
function getCountryCode(cleanPhone, currency) {
  if (currency === 'UGX') return 'UG';
  if (currency === 'KES') return 'KE';
  if (currency === 'TZS') return 'TZ';
  if (currency === 'RWF') return 'RW';
  if (currency === 'BIF') return 'BI';
  if (currency === 'USD') return 'UG'; // default to UG for USD in QA

  if (cleanPhone.startsWith('257')) return 'BI';
  if (cleanPhone.startsWith('254')) return 'KE';
  if (cleanPhone.startsWith('255')) return 'TZ';
  if (cleanPhone.startsWith('250')) return 'RW';
  return 'UG';
}

async function getToken() {
  if (cachedToken && Date.now() < cachedExpiry) return cachedToken;

  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;

  if (!key ||!secret) throw new Error('Missing PESAPAL_CONSUMER_KEY or SECRET in.env');

  console.log(`Requesting Pesapal token from ${PESAPAL_BASE}...`);
  const res = await axios.post(`${PESAPAL_BASE}/api/Auth/RequestToken`, {
    consumer_key: key.trim(),
    consumer_secret: secret.trim()
  });

  cachedToken = res.data.token;
  cachedExpiry = Date.now() + 4 * 60 * 1000;
  console.log('Pesapal token OK');
  return cachedToken;
}

async function createPaymentOrder({ amount, phone, campaignId, donationId, currency = 'UGX' }) {
  const token = await getToken();
  const cleanPhone = normalizePhone(phone);
  const countryCode = getCountryCode(cleanPhone, currency);

  console.log(`PaymentOrder: raw=${phone} -> clean=${cleanPhone} country=${countryCode} currency=${currency} id=${donationId}`);

  if (!process.env.PESAPAL_CALLBACK_URL) throw new Error('Missing PESAPAL_CALLBACK_URL in.env');
  if (!process.env.PESAPAL_IPN_ID) throw new Error('Missing PESAPAL_IPN_ID in.env');

  const payload = {
    id: donationId,
    currency: currency,
    amount: Number(amount),
    description: `Ask Kin - Campaign ${campaignId}`,
    callback_url: `${process.env.PESAPAL_CALLBACK_URL}?donationId=${donationId}`,
    notification_id: process.env.PESAPAL_IPN_ID,
    billing_address: {
      phone_number: cleanPhone,
      email_address: `${cleanPhone}@askkin.guest`,
      country_code: countryCode,
      first_name: "Guest",
      last_name: "Donor"
    }
  };

  const res = await axios.post(`${PESAPAL_BASE}/api/Transactions/SubmitOrderRequest`, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });

  console.log('Pesapal order created:', res.data.order_tracking_id);
  return res.data; // contains order_tracking_id, redirect_url, merchant_reference
}

async function checkPaymentStatus(orderTrackingId) {
  const token = await getToken();
  const res = await axios.get(`${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

module.exports = { createPaymentOrder, checkPaymentStatus, normalizePhone };