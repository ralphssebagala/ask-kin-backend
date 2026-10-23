const express = require('express');
const router = express.Router();
const db = require('../config/db');
const axios = require('axios');
const crypto = require('crypto');

async function getPesapalToken() {
  const res = await axios.post(
    `${process.env.PESAPAL_BASE_URL}/api/Auth/RequestToken`,
    {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    }
  );
  return res.data.token;
}

// AUTO - this is the one that proves Failed vs Completed
router.post('/auto-complete', async (req, res) => {
  const { orderTrackingId, campaignId } = req.body;
  let conn;
  try {
    const token = await getPesapalToken();
    const r = await axios.get(
      `${process.env.PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const data = r.data; // This is the Pesapal response
    conn = await db.getConnection();

    // LOG EVERYTHING - even if Failed
    await conn.execute(
      `INSERT INTO DONATIONS (ID, CAMPAIGN_ID, AMOUNT, DONOR_NAME, ORDER_TRACKING_ID, STATUS, PAYMENT_STATUS_DESC, PESAPAL_RAW, CREATED_AT)
       VALUES (:id, :cid, :amt, :name, :oid, :status, :desc, :raw, SYSTIMESTAMP)`,
      {
        id: crypto.randomUUID(),
        cid: campaignId,
        amt: data.amount || 0,
        name: 'Pesapal User',
        oid: orderTrackingId,
        status: data.payment_status_description, // FAILED or COMPLETED - THIS IS YOUR PROOF
        desc: data.payment_status_description,
        raw: JSON.stringify(data)
      },
      { autoCommit: false }
    );

    if (data.payment_status_description !== 'Completed') {
      await conn.commit();
      return res.status(400).json({ 
        proof: 'LOGGED AS FAILED', 
        pesapal_says: data.payment_status_description,
        data 
      });
    }

    // Only if Completed -> update campaign
    await conn.execute(`UPDATE CAMPAIGNS SET RAISED = RAISED + :amt WHERE ID = :id`, 
      { amt: data.amount, id: campaignId });
    await conn.commit();
    
    res.json({ proof: 'LOGGED AS COMPLETED AND RAISED UPDATED', data });

  } catch (e) {
    if(conn) try{ await conn.rollback(); }catch(_){}
    res.status(500).json({ error: e.message, details: e.response?.data });
  } finally {
    if(conn) await conn.close();
  }
});

// MANUAL fallback
router.post('/dev-complete', async (req, res) => {
  const { orderTrackingId, campaignId, amount } = req.body;
  let conn;
  try {
    conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO DONATIONS (ID, CAMPAIGN_ID, AMOUNT, DONOR_NAME, ORDER_TRACKING_ID, STATUS, CREATED_AT)
       VALUES (:id, :cid, :amt, :name, :oid, 'MANUAL', SYSTIMESTAMP)`,
      { id: crypto.randomUUID(), cid: campaignId, amt: amount, name: 'Dev Test', oid: orderTrackingId }
    );
    await conn.execute(`UPDATE CAMPAIGNS SET RAISED = RAISED + :amt WHERE ID = :id`, { amt: amount, id: campaignId });
    await conn.commit();
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
  finally{ if(conn) await conn.close(); }
});

module.exports = router;