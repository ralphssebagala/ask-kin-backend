const express = require('express');
const axios = require('axios');
const oracledb = require('oracledb');
const db = require('../config/db');
const router = express.Router();
const { sendDonationEmail } = require('../utils/email');

async function getPesapalToken() {
  const baseUrl = process.env.PESAPAL_BASE_URL || process.env.PESAPAL_BASE || 'https://cybqa.pesapal.com/pesapalv3';
  const res = await axios.post(baseUrl + '/api/Auth/RequestToken', {
    consumer_key: process.env.PESAPAL_CONSUMER_KEY,
    consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
  });
  return { token: res.data.token, baseUrl: baseUrl };
}

router.post('/create', async (req, res) => {
  let conn;
  try {
    const b = req.body;
    const campaignId = b.campaignId;
    const amount = Number(b.amount);
    if (!campaignId || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Missing fields' });
    }
    const totalCharged = amount;
    const platform_fee = Math.round(totalCharged * 0.10);
    const beneficiary_amount = totalCharged - platform_fee;
    const donationId = 'ASK-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
    const tok = await getPesapalToken();
    const token = tok.token;
    const baseUrl = tok.baseUrl;
    const callback_url = (process.env.FRONTEND_URL || 'https://www.ask-kin.com') + '/payment-callback';
    const notification_id = process.env.PESAPAL_IPN_ID;
    const effectiveCurrency = (b.currency || 'UGX').toUpperCase();
    const safeEmail = b.donorEmail && b.donorEmail.indexOf('@') > -1 ? b.donorEmail : 'donor_' + Date.now() + '@ask-kin.com';
    const safePhone = b.donorPhone || '256700000000';
    const donorDisplay = b.nickname || b.donorName || 'Anonymous';
    const pesapalBody = {
      id: donationId,
      currency: effectiveCurrency,
      amount: totalCharged,
      description: 'Donation for campaign ' + campaignId + ' - Ask Kin',
      callback_url: callback_url,
      notification_id: notification_id,
      billing_address: {
        email_address: safeEmail,
        phone_number: safePhone,
        first_name: donorDisplay.substring(0,50),
        last_name: b.isAnonymous ? 'Anonymous' : 'Donor',
      },
    };
    const pesapalRes = await axios.post(baseUrl + '/api/Transactions/SubmitOrderRequest', pesapalBody, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    const order_tracking_id = pesapalRes.data.order_tracking_id;
    const redirect_url = pesapalRes.data.redirect_url;
    conn = await db.getConnection();
    await conn.execute(
      'INSERT INTO DONATIONS (ID, CAMPAIGN_ID, AMOUNT, BENEFICIARY_AMOUNT, PLATFORM_FEE, DONOR_NAME, DONOR_EMAIL, DONOR_PHONE, DONOR_MESSAGE, CURRENCY, STATUS, PESAPAL_TRACKING_ID, ORDER_TRACKING_ID, COVER_FEE, IS_ANONYMOUS, CREATED_AT, PAYOUT_STATUS) VALUES (:id, :cid, :amt, :ben, :fee, :name, :email, :phone, :msg, :curr, \'PENDING\', :ptid, :otid, :cover, :anon, SYSTIMESTAMP, \'PENDING\')',
      {
        id: donationId,
        cid: campaignId,
        amt: totalCharged,
        ben: beneficiary_amount,
        fee: platform_fee,
        name: donorDisplay,
        email: b.donorEmail || null,
        phone: safePhone,
        msg: b.message || null,
        curr: effectiveCurrency,
        ptid: order_tracking_id,
        otid: order_tracking_id,
        cover: b.coverFee ? 1 : 0,
        anon: b.isAnonymous ? 1 : 0,
      },
      { autoCommit: true }
    );
    res.json({ donationId: donationId, order_tracking_id: order_tracking_id, redirect_url: redirect_url, redirectUrl: redirect_url, amount: totalCharged, beneficiary_amount: beneficiary_amount, platform_fee: platform_fee, currency: effectiveCurrency });
  } catch (e) {
    console.error('Create donation error:', e.response ? e.response.data : e.message);
    res.status(500).json({ error: e.response ? e.response.data : e.message });
  } finally {
    if (conn) { try { await conn.close(); } catch (ex) {} }
  }
});

router.get('/callback', async (req, res) => {
  let conn;
  try {
    const OrderTrackingId = req.query.OrderTrackingId;
    const OrderMerchantReference = req.query.OrderMerchantReference;
    if (!OrderTrackingId) return res.status(400).json({ message: 'Missing tracking id' });
    const tok = await getPesapalToken();
    const s = await axios.get(tok.baseUrl + '/api/Transactions/GetTransactionStatus?orderTrackingId=' + OrderTrackingId, { headers: { Authorization: 'Bearer ' + tok.token } });
    const isSuccess = s.data.payment_status_description === 'Completed' || s.data.status_code === 1;
    if (isSuccess) {
      conn = await db.getConnection();
      await conn.execute('UPDATE DONATIONS SET STATUS=\'SUCCESS\', UPDATED_AT=SYSTIMESTAMP WHERE PESAPAL_TRACKING_ID=:tid OR ORDER_TRACKING_ID=:tid2 OR ID=:id', { tid: OrderTrackingId, tid2: OrderTrackingId, id: OrderMerchantReference }, { autoCommit: true });
      const r = await conn.execute('SELECT * FROM DONATIONS WHERE PESAPAL_TRACKING_ID=:tid OR ID=:id', { tid: OrderTrackingId, id: OrderMerchantReference }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (r.rows[0]) {
        const donation = r.rows[0];
        await conn.execute('UPDATE CAMPAIGNS SET RAISED=(SELECT NVL(SUM(NVL(BENEFICIARY_AMOUNT, AMOUNT*0.9)),0) FROM DONATIONS WHERE CAMPAIGN_ID=:c AND STATUS=\'SUCCESS\'), PENDING_BALANCE=NVL(PENDING_BALANCE,0)+:ben WHERE ID=:c2', { c: donation.CAMPAIGN_ID, c2: donation.CAMPAIGN_ID, ben: donation.BENEFICIARY_AMOUNT || 0 }, { autoCommit: true });
        if (donation.DONOR_EMAIL) { try { await sendDonationEmail(donation); } catch (ex) {} }
      }
    }
    res.redirect((process.env.FRONTEND_URL || 'https://www.ask-kin.com') + '/payment-callback?OrderTrackingId=' + OrderTrackingId + '&OrderMerchantReference=' + OrderMerchantReference);
  } catch (e) {
    res.redirect((process.env.FRONTEND_URL || 'https://www.ask-kin.com') + '/payment-callback?OrderTrackingId=' + (req.query.OrderTrackingId || '') + '&OrderMerchantReference=' + (req.query.OrderMerchantReference || '') + '&error=callback');
  } finally {
    if (conn) { try { await conn.close(); } catch (ex) {} }
  }
});

router.post('/ipn', async (req, res) => {
  let conn;
  try {
    const OrderTrackingId = req.body.OrderTrackingId;
    const OrderMerchantReference = req.body.OrderMerchantReference;
    if (!OrderTrackingId) return res.status(400).json({ message: 'Missing tracking id' });
    const tok = await getPesapalToken();
    const s = await axios.get(tok.baseUrl + '/api/Transactions/GetTransactionStatus?orderTrackingId=' + OrderTrackingId, { headers: { Authorization: 'Bearer ' + tok.token } });
    const isSuccess = s.data.payment_status_description === 'Completed' || s.data.status_code === 1;
    if (isSuccess) {
      conn = await db.getConnection();
      await conn.execute('UPDATE DONATIONS SET STATUS=\'SUCCESS\', UPDATED_AT=SYSTIMESTAMP WHERE PESAPAL_TRACKING_ID=:tid OR ORDER_TRACKING_ID=:tid2 OR ID=:id', { tid: OrderTrackingId, tid2: OrderTrackingId, id: OrderMerchantReference }, { autoCommit: true });
      const r = await conn.execute('SELECT * FROM DONATIONS WHERE PESAPAL_TRACKING_ID=:tid OR ID=:id', { tid: OrderTrackingId, id: OrderMerchantReference }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (r.rows[0]) {
        const donation = r.rows[0];
        await conn.execute('UPDATE CAMPAIGNS SET RAISED=(SELECT NVL(SUM(NVL(BENEFICIARY_AMOUNT, AMOUNT*0.9)),0) FROM DONATIONS WHERE CAMPAIGN_ID=:c AND STATUS=\'SUCCESS\'), PENDING_BALANCE=NVL(PENDING_BALANCE,0)+:ben WHERE ID=:c2', { c: donation.CAMPAIGN_ID, c2: donation.CAMPAIGN_ID, ben: donation.BENEFICIARY_AMOUNT || 0 }, { autoCommit: true });
        if (donation.DONOR_EMAIL) { try { await sendDonationEmail(donation); } catch (ex) {} }
      }
    }
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) { try { await conn.close(); } catch (ex) {} }
  }
});

router.get('/:id', async (req, res) => {
  let conn;
  try {
    const id = req.params.id;
    conn = await db.getConnection();
    const r = await conn.execute('SELECT * FROM DONATIONS WHERE ID=:a OR PESAPAL_TRACKING_ID=:a OR ORDER_TRACKING_ID=:a', { a: id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if (!r.rows.length) return res.status(404).json({ message: 'Donation not found' });
    let donation = r.rows[0];
    if (donation.STATUS !== 'SUCCESS' && donation.STATUS !== 'COMPLETED') {
      try {
        const tok = await getPesapalToken();
        const tid = donation.PESAPAL_TRACKING_ID || donation.ORDER_TRACKING_ID;
        if (tid) {
          const s = await axios.get(tok.baseUrl + '/api/Transactions/GetTransactionStatus?orderTrackingId=' + tid, { headers: { Authorization: 'Bearer ' + tok.token } });
          const isSuccess = s.data.payment_status_description === 'Completed' || s.data.status_code === 1;
          if (isSuccess) {
            await conn.execute('UPDATE DONATIONS SET STATUS=\'SUCCESS\', UPDATED_AT=SYSTIMESTAMP WHERE ID=:v', { v: donation.ID }, { autoCommit: true });
            await conn.execute('UPDATE CAMPAIGNS SET RAISED=(SELECT NVL(SUM(NVL(BENEFICIARY_AMOUNT, AMOUNT*0.9)),0) FROM DONATIONS WHERE CAMPAIGN_ID=:c AND STATUS=\'SUCCESS\'), PENDING_BALANCE=NVL(PENDING_BALANCE,0)+:ben WHERE ID=:c2', { c: donation.CAMPAIGN_ID, c2: donation.CAMPAIGN_ID, ben: donation.BENEFICIARY_AMOUNT || 0 }, { autoCommit: true });
            donation.STATUS = 'SUCCESS';
            if (donation.DONOR_EMAIL) { try { await sendDonationEmail(donation); } catch (ex) {} }
          }
        }
      } catch (ex) { console.log('Verify err', ex.message); }
    }
    res.json(donation);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) { try { await conn.close(); } catch (ex) {} }
  }
});

router.get('/campaign/:campaignId', async (req, res) => {
  let conn;
  try {
    const campaignId = req.params.campaignId;
    conn = await db.getConnection();
    const r = await conn.execute(
      'SELECT ID, DONOR_NAME, AMOUNT, BENEFICIARY_AMOUNT, CURRENCY, IS_ANONYMOUS, DONOR_MESSAGE, CREATED_AT FROM DONATIONS WHERE CAMPAIGN_ID=:cid AND STATUS IN (\'SUCCESS\',\'COMPLETED\') ORDER BY CREATED_AT DESC FETCH FIRST 50 ROWS ONLY',
      { cid: campaignId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const donations = r.rows.map(function(row) {
      return {
        id: row.ID,
        name: row.IS_ANONYMOUS ? 'Anonymous' : (row.DONOR_NAME || 'Anonymous'),
        amount: row.BENEFICIARY_AMOUNT || row.AMOUNT * 0.9,
        totalAmount: row.AMOUNT,
        currency: row.CURRENCY,
        isAnonymous: !!row.IS_ANONYMOUS,
        message: row.DONOR_MESSAGE,
        time: row.CREATED_AT
      };
    });
    res.json({ donations: donations, count: donations.length });
  } catch (e) {
    console.error('campaign donations error', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) { try { await conn.close(); } catch (ex) {} }
  }
});

module.exports = router;

