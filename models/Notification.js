const db = require('../db');

const Notification = {
  createUser({ userId, type, message, tradeId }, callback) {
    const sql = `
      INSERT INTO notifications (scope, user_id, type, message, trade_id)
      VALUES ('user', ?, ?, ?, ?)
    `;
    db.query(sql, [userId, type, message, tradeId || null], (err, result) => callback(err, result));
  },

  createGlobal({ type, message, tradeId }, callback) {
    const sql = `
      INSERT INTO notifications (scope, user_id, type, message, trade_id)
      VALUES ('global', NULL, ?, ?, ?)
    `;
    db.query(sql, [type, message, tradeId || null], (err, result) => callback(err, result));
  },

  listForUser(userId, limit, callback) {
    const sql = `
      SELECT * FROM notifications
      WHERE scope = 'user' AND user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    db.query(sql, [userId, limit], (err, results) => callback(err, results));
  },

  listGlobal(limit, callback) {
    const sql = `
      SELECT * FROM notifications
      WHERE scope = 'global'
      ORDER BY created_at DESC
      LIMIT ?
    `;
    db.query(sql, [limit], (err, results) => callback(err, results));
  }
};

module.exports = Notification;
