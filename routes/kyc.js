const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');

// POST /api/kyc/callback  <- Smile calls this
router.post('/callback', async (req, res) => {
    const signature = req.headers['x-smileid-signature'];
    if (!signature) return res.status(401).json({ error: 'No signature' });

    const secret = process.env.SMILE_ID_API_KEY || process.env.SMILE_ID_SECRET;
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');

    if (signature !== expected) {
        console.log('KYC REJECT - bad signature');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    const { userId, result } = req.body;
    const status = result?.Actions?.Verify_Document === 'PASSED' ? 'VERIFIED' : 'FAILED';
    const verified = status === 'VERIFIED' ? 1 : 0;

    let conn;
    try {
        conn = await db.getConnection();
        const r = await conn.execute(
            `UPDATE users SET kyc_status = :s, id_verified = :v WHERE id = :id`,
            { s: status, v: verified, id: userId },
            { autoCommit: true }
        );
        if (r.rowsAffected === 0) return res.status(404).json({ error: 'User not found' });
        
        console.log(`KYC ${status} for ${userId}`);
        res.json({ status: 'success', kyc: status });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    } finally {
        if (conn) await conn.close();
    }
});

module.exports = router;
