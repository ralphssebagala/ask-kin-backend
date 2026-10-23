require('dotenv').config();
const db = require('./config/db');
async function fixSchema() {
    let conn;
    try {
        conn = await db.getConnection();
        await conn.execute("ALTER TABLE users ADD (kyc_status VARCHAR2(20) DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'FAILED')))");
        await conn.commit();
        console.log('Successfully added kyc_status column to users table.');
    } catch (err) {
        if (err.oracleError && err.oracleError.code === 1430) {
            console.log('Column kyc_status already exists.');
        } else {
            console.error('Error altering table:', err.message);
        }
    } finally {
        if (conn) await conn.close();
    }
}
fixSchema();