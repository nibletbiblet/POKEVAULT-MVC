const mysql = require('mysql2');
try { require('dotenv').config(); } catch (err) {
  // If dotenv isn't installed, attempt a minimal .env parse for DB vars
  try {
    const fs = require('fs');
    if (fs.existsSync('.env')) {
      const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
      lines.forEach(line => {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      });
    }
  } catch (_) { /* ignore */ }
}

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

module.exports = db;
