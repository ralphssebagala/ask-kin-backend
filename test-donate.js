require('dotenv').config();
const axios = require('axios');

(async () => {
  try {
    const res = await axios.post('http://localhost:5000/api/donations/init', {
      campaignId: "1D6AB8259ECC4ED48BD5337E68969551",              // use a real CAMPAIGNS.ID from your DB, e.g. "1" or "test123"
      payAmount: 1100,              // what user pays (with 10% fee)
      netToCampaign: 1000,          // what campaign gets (90%)
      phone: "0755123456",          // MUST start with 07... (your validation)
      donorName: "Ralph Test",
      coverFees: true
    });
    console.log('SUCCESS!');
    console.log(JSON.stringify(res.data, null, 2));
    console.log('\nCopy redirectUrl to browser to see Pesapal Sandbox checkout');
  } catch (e) {
    console.log('FAILED:');
    console.log(e.response?.data || e.message);
  }
})();