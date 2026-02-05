const db = require('../db');

const UserBanHistory = {
  create({ userId, action, reason, adminId }, cb) {
    const sql = `
      INSERT INTO user_ban_history (userId, action, reason, adminId, createdAt)
      VALUES (?, ?, ?, ?, NOW())
    `;
    db.query(sql, [userId, action, reason || null, adminId || null], cb);
  },

  getByUserId(userId, cb) {
    const sql = `
      SELECT h.userId, h.action, h.reason, h.adminId, h.createdAt, a.username AS adminName
      FROM user_ban_history h
      LEFT JOIN users a ON a.id = h.adminId
      WHERE h.userId = ?
      ORDER BY h.createdAt DESC
    `;
    db.query(sql, [userId], cb);
  }
};

module.exports = UserBanHistory;
