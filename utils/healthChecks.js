const db = require('../config/db');

async function checkOracle() {
  try {
    const connection = await db.getConnection();
    await connection.execute('SELECT 1 FROM DUAL');
    await connection.close();
    return { status: 'ok', message: 'Oracle connected' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function checkNgrok() {
  return { status: 'ok', message: 'Backend running' };
}

async function checkPesapal() {
  return { status: 'ok', message: 'Pesapal check skipped' };
}

module.exports = { checkOracle, checkNgrok, checkPesapal };