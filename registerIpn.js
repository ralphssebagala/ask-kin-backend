require('dotenv').config();
const axios = require('axios');

(async()=>{
  const base = 'https://cybqa.pesapal.com/pesapalv3';
  const auth = await axios.post(`${base}/api/Auth/RequestToken`, {
    consumer_key: process.env.PESAPAL_CONSUMER_KEY,
    consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
  });
  const token = auth.data.token;
  console.log('Token OK');

  const ipn = await axios.post(`${base}/api/URLSetup/RegisterIPN`, {
    url: `https://example.com/api/pesapal/ipn`,
    ipn_notification_type: 'POST'
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });

  console.log('IPN OK:', ipn.data);
  console.log(`PESAPAL_IPN_ID=${ipn.data.ipn_id}`);
})();