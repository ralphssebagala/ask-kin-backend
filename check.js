const oracledb = require('oracledb');
require('dotenv').config();

(async () => {
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING
  });
  const result = await conn.execute(
    `SELECT column_name, data_type FROM user_tab_columns WHERE table_name = UPPER('campaigns') ORDER BY column_id`
  );
  console.log("YOUR REAL COLUMNS ARE:");
  console.log(result.rows);
  await conn.close();
})();