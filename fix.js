require('dotenv').config();
const db = require('./config/db');
(async () => {
  const conn = await db.getConnection();
  const cols = [
    `NET_AMOUNT NUMBER`,
    `FEE NUMBER`,
    `DONOR_PHONE VARCHAR2(20)`,
    `STATUS VARCHAR2(20) DEFAULT 'PENDING'`,
    `ORDER_TRACKING_ID VARCHAR2(100)`
  ];
  for (let col of cols) {
    try {
      await conn.execute(`ALTER TABLE DONATIONS ADD (${col})`);
      console.log(`Added ${col}`);
    } catch(e) {
      console.log(`${col} - ${e.message.split('\n')[0]}`);
    }
  }
  await conn.close();
  console.log("✅ DONE");
})();