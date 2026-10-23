const oracledb = require('oracledb');
require('dotenv').config();

async function seed() {
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING
  });

  await conn.execute(`DELETE FROM campaigns`, [], { autoCommit: true });

  const campaigns = [
    ["Help Achenyo's Son Join P7", "Education", "Achenyo is a single mother in Gulu. Her son needs fees for his P7 final exams. Let's rekindle the gift of giving.", 2500000, 1750000, 30, "https://images.unsplash.com/photo-1491485880348-85d48a9e5312", "test_user"],
    ["Emergency Medical Fund - Baby Bless", "Medical", "Baby Bless needs urgent heart surgery at Mulago Hospital, Kampala.", 8000000, 3200000, 45, "https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7", "test_user"],
    ["Rebuild Mama Naki's Market Stall", "Community", "Mama Naki's stall in Mbale was destroyed by fire. Help her restart.", 1500000, 900000, 21, "https://images.unsplash.com/photo-1488459716781-31db52582fe9", "test_user"],
    ["Kigali Youth Football Kits", "Sports", "East Africa cradle: supporting youth talent in Rwanda with kits.", 3000000, 1100000, 30, "https://images.unsplash.com/photo-1579952363873-27f3bfad9c0d", "test_user"],
    ["Nairobi Flood Relief - Mathare", "Disaster", "Families displaced by floods in Mathare, Kenya need food and shelter.", 12000000, 5400000, 60, "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c", "test_user"],
    ["Wheelchair for Okello", "Accessibility", "Okello is a bright student in Lira who needs a wheelchair to get to school.", 4000000, 3800000, 30, "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158", "test_user"]
  ];

  for (const c of campaigns) {
    await conn.execute(
      `INSERT INTO campaigns (ID, TITLE, CATEGORY, DESCRIPTION, GOAL, RAISED, DURATION_DAYS, IMAGE, CREATOR_ID) VALUES (SYS_GUID(), :1,:2,:3,:4,:5,:6,:7,:8)`,
      c,
      { autoCommit: true }
    );
  }

  console.log("✅ 6 Ask Kin campaigns seeded to Oracle - ready for modern cards!");
  await conn.close();
}
seed();

