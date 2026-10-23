const crypto = require('crypto');
require('dotenv').config();

async function sendTestWebhook() {
  const secret = process.env.SMILE_ID_SECRET;
  
  if (!secret) {
    console.error('Error: SMILE_ID_SECRET is missing from your .env file.');
    return;
  }

  const payload = JSON.stringify({
    event: 'kyc_verification_success',
    user_id: 'test-user-id',
    timestamp: new Date().toISOString()
  });

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  console.log('Generated Signature:', signature);

  try {
    const response = await fetch('http://localhost:5000/smile-id-webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-smile-signature': signature
      },
      body: payload
    });

    const result = await response.text();
    console.log(`Response Status: ${response.status}`);
    console.log(`Response Body: ${result}`);
  } catch (error) {
    console.error('Test request failed:', error);
  }
}

sendTestWebhook();