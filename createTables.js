require('dotenv').config();
const oracledb = require('oracledb');
const db = require('./config/db');

async function safeCreate(conn, name, sql){
  try {
    await conn.execute(sql);
    console.log(`✅ Created ${name}`);
  } catch(e){
    if(e.message.includes('ORA-00955')){
      console.log(`ℹ️ ${name} already exists - skipping`);
    } else {
      console.error(`❌ ${name} error:`, e.message);
    }
  }
}

async function run(){
  await db.initialize();
  const conn = await db.getConnection();
  try{
    await safeCreate(conn, 'USERS', `
      CREATE TABLE USERS (
        ID VARCHAR2(50) PRIMARY KEY,
        NAME VARCHAR2(255),
        EMAIL VARCHAR2(255) UNIQUE NOT NULL,
        PASSWORD VARCHAR2(500) NOT NULL,
        PHONE VARCHAR2(50),
        MOBILE_MONEY_NAME VARCHAR2(255),
        MOBILE_MONEY_NUMBER VARCHAR2(50),
        PROVIDER VARCHAR2(20),
        PAYOUT_METHOD VARCHAR2(20),
        BANK_NAME VARCHAR2(100),
        ACCOUNT_NAME VARCHAR2(255),
        ACCOUNT_NUMBER VARCHAR2(100),
        ID_TYPE VARCHAR2(50),
        ID_NUMBER VARCHAR2(100),
        CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP
      )`);

    await safeCreate(conn, 'CAMPAIGNS', `
      CREATE TABLE CAMPAIGNS (
        ID VARCHAR2(50) PRIMARY KEY,
        TITLE VARCHAR2(255) NOT NULL,
        CATEGORY VARCHAR2(100),
        DESCRIPTION CLOB,
        GOAL NUMBER DEFAULT 0,
        RAISED NUMBER DEFAULT 0,
        DURATION_DAYS NUMBER,
        IMAGE VARCHAR2(500),
        CREATOR_ID VARCHAR2(100),
        CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP
      )`);

    await safeCreate(conn, 'DONATIONS', `
      CREATE TABLE DONATIONS (
        ID VARCHAR2(50) PRIMARY KEY,
        CAMPAIGN_ID VARCHAR2(50),
        AMOUNT NUMBER NOT NULL,
        DONOR_NAME VARCHAR2(255),
        IS_ANONYMOUS NUMBER(1) DEFAULT 0,
        MESSAGE CLOB,
        CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP
      )`);

    const check = await conn.execute(
      `SELECT table_name FROM user_tables WHERE table_name IN ('USERS','CAMPAIGNS','DONATIONS')`,
      [], {outFormat: oracledb.OUT_FORMAT_OBJECT}
    );
    console.log('Current tables:', check.rows);

  } finally {
    await conn.close();
    process.exit();
  }
}
run();