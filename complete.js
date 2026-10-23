require('dotenv').config();
const oracledb = require('oracledb');
(async()=>{
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING
  });
  // Find which campaign this donation was for
  const don = await conn.execute(`SELECT ID, CAMPAIGN_ID, AMOUNT, STATUS FROM donations WHERE ID='1789841856397'`);
  console.log('DONATION:', don.rows);

  const campaignId = don.rows[0][1];
  console.log('Campaign ID from donation:', campaignId);

  // Update the CORRECT campaign
  await conn.execute(`UPDATE campaigns SET RAISED = NVL(TO_NUMBER(RAISED),0)+1100 WHERE ID=:id`, [campaignId]);
  await conn.commit();

  const res = await conn.execute(`SELECT ID, TITLE, RAISED FROM campaigns WHERE ID=:id`, [campaignId]);
  console.log('UPDATED CAMPAIGN:', res.rows);

  await conn.close();
})()