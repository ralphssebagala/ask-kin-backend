require('dotenv').config();
const db = require('./config/db');

async function run() {
  let conn;
  try {
    await db.initialize();
    conn = await db.getConnection();
    console.log('Connected, adding columns...');

    const sql = `
    ALTER TABLE users ADD (
      phone VARCHAR2(20),
      payout_method VARCHAR2(20) DEFAULT 'momo',
      momo_provider VARCHAR2(20),
      momo_name VARCHAR2(100),
      bank_name VARCHAR2(100),
      account_no VARCHAR2(50),
      id_type VARCHAR2(50),
      id_number VARCHAR2(100),
      kyc_status VARCHAR2(20) DEFAULT 'PENDING',
      id_verified NUMBER(1) DEFAULT 0,
      name_match NUMBER(1) DEFAULT 0
    )`;

    await conn.execute(sql);
    await conn.commit();
    console.log('✅ Columns added');
  } catch (e) {
    if (e.errorNum === 1430) console.log('✅ Already exists, skip');
    else console.error('❌', e.message);
  } finally {
    if (conn) await conn.close();
    process.exit(0);
  }
}
run();