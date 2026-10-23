const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool;

async function initialize() {
  try {
    pool = await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING,
      poolMin: 1,
      poolMax: 4,
      poolIncrement: 1
    });
    console.log('Oracle Database pool initialized.');
  } catch (err) {
    console.error('DB Init Error:', err);
    throw err;
  }
}

async function getConnection() {
  if (!pool) {
    await initialize();
  }
  return await pool.getConnection();
}

module.exports = { initialize, getConnection };
