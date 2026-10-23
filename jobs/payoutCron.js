const cron = require('node-cron');
const oracledb = require('oracledb');
const db = require('../config/db');

const THRESHOLDS = {
  UGX: 50000,
  KES: 500,
  TZS: 10000,
  RWF: 5000,
  BIF: 10000,
  USD: 10
};

async function runMondayPayouts() {
  let conn;
  console.log(`\n[CRON] 🔔 Monday payout check started at ${new Date().toISOString()} - EAT 10am`);
  try {
    conn = await db.getConnection();

    // Find all eligible
    const result = await conn.execute(
      `SELECT ID, TITLE, CAMPAIGN_CURRENCY, PENDING_BALANCE, PAYOUT_METHOD, PAYOUT_PROVIDER, PAYOUT_MOMO_NUMBER, BANK_NAME, BANK_ACCOUNT_NUMBER, BANK_ACCOUNT_NAME
       FROM CAMPAIGNS WHERE PENDING_BALANCE > 0`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let paidCount = 0;
    let totalPaid = 0;

    for (const c of result.rows) {
      const pending = Number(c.PENDING_BALANCE || 0);
      const thr = THRESHOLDS[c.CAMPAIGN_CURRENCY] || 50000;

      if (pending < thr) {
        console.log(`[CRON] ⏩ Skip ${c.TITLE} - ${pending} < ${thr} ${c.CAMPAIGN_CURRENCY} (need ${thr - pending} more)`);
        continue;
      }

      const payoutId = `pay_${Date.now()}_${paidCount}`;
      const dest = (c.PAYOUT_METHOD||'').toLowerCase().includes('bank')
        ? `${c.BANK_NAME} ${c.BANK_ACCOUNT_NUMBER} (${c.BANK_ACCOUNT_NAME})`
        : `${c.PAYOUT_PROVIDER} ${c.PAYOUT_MOMO_NUMBER}`;

      // Insert payout
      await conn.execute(
        `INSERT INTO PAYOUTS (ID, CAMPAIGN_ID, AMOUNT, CURRENCY, PAYOUT_METHOD, PAYOUT_DESTINATION, STATUS, CREATED_AT)
         VALUES (:v_id, :v_cid, :v_amt, :v_cur, :v_method, :v_dest, 'PAID', SYSDATE)`,
        {
          v_id: payoutId,
          v_cid: c.ID,
          v_amt: pending,
          v_cur: c.CAMPAIGN_CURRENCY,
          v_method: c.PAYOUT_METHOD,
          v_dest: dest
        }
      );

      // Reset
      await conn.execute(
        `UPDATE CAMPAIGNS SET TOTAL_PAID_OUT = NVL(TOTAL_PAID_OUT,0) + :v_amt, PENDING_BALANCE = 0 WHERE ID = :v_cid`,
        { v_amt: pending, v_cid: c.ID }
      );

      console.log(`[CRON] ✅ PAID ${c.TITLE} - ${pending} ${c.CAMPAIGN_CURRENCY} -> ${dest}`);
      paidCount++;
      totalPaid += pending;
    }

    await conn.commit();
    console.log(`[CRON] 🎉 Done. Paid ${paidCount} campaigns, total ${totalPaid}. Next run Monday 10am EAT.\n`);

  } catch (err) {
    console.error('[CRON] ❌ Payout error:', err.message);
  } finally {
    if (conn) await conn.close();
  }
}

function startPayoutCron() {
  // Monday 10am EAT = Monday 7am UTC (EAT is UTC+3)
  // cron format: minute hour day month weekday
  cron.schedule('0 7 * * 1', () => {
    runMondayPayouts();
  }, {
    timezone: "UTC"
  });

  console.log('[CRON] ⏰ Payout cron scheduled: Every Monday 7am UTC / 10am EAT (Kampala)');

  // Optional: also run every day at 10am for testing, comment out in production
  // cron.schedule('0 7 * * *', runMondayPayouts);
}

module.exports = { startPayoutCron, runMondayPayouts };