const db = require('../db');

class RefundRequestModel {
  static createRequest(orderId, userId, reason, description, callback) {
    const sql = `
      INSERT INTO refund_requests (order_id, user_id, reason, description, status)
      VALUES (?, ?, ?, ?, 'PENDING')
    `;
    db.query(sql, [orderId, userId, reason, description], callback);
  }

  static getByOrder(orderId, callback) {
    const sql = `
      SELECT *
      FROM refund_requests
      WHERE order_id = ?
      ORDER BY id DESC
      LIMIT 1
    `;
    db.query(sql, [orderId], callback);
  }

  static updateStatus(requestId, status, callback) {
    const sql = `
      UPDATE refund_requests
      SET status = ?
      WHERE id = ?
    `;
    db.query(sql, [status, requestId], callback);
  }
}

module.exports = RefundRequestModel;
