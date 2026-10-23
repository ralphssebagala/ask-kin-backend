const crypto = require('crypto');
require('dotenv').config();

const payload = JSON.stringify({ user_id: "USER_12345", event: "kyc_verification" });
const secret = process.env.SMILE_ID_SECRET;

const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log("Generated Signature:", signature);