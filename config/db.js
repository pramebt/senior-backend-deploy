const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ฟังก์ชันสำหรับใช้ pool
const connectDB = async () => {
  try {
    const connection = await pool.getConnection(); // ได้ connection จาก pool
    console.log("Connected to MySQL");
    return connection;
  } catch (err) {
    console.error("Error connecting to MySQL:", err);
    throw err; // ส่ง error กลับไปถ้ามีปัญหา
  }
};

module.exports = { pool, connectDB };
