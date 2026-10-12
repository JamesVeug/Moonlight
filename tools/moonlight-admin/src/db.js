const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "moonlight",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_NAME || "Moonlight",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_LIMIT || 8),
  queueLimit: 0,
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = {
  pool,
  query,
};
