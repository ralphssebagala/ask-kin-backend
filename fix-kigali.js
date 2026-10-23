require('dotenv').config();
const oracledb = require('oracledb');

async function fix(){
  let conn;
  try{
    // uses same env as your server.js
    conn = await oracledb.getConnection({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING
    });
    await conn.execute(
      `UPDATE CAMPAIGNS SET IMAGE = :img WHERE UPPER(TITLE) LIKE '%KIGALI%'`,
      ['https://images.unsplash.com/photo-1543351611-58f69d7c1781?w=800']
    );
    await conn.commit();
    console.log('✅ Kigali image fixed!');
  }catch(e){ console.error(e.message); }
  finally{ if(conn) await conn.close(); }
}
fix();