/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
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

  static updateStatusWithRejectReason(requestId, status, rejectReason, callback) {
    const sql = `
      UPDATE refund_requests
      SET status = ?, reject_reason = ?
      WHERE id = ?
    `;
    db.query(sql, [status, rejectReason || null, requestId], callback);
  }

  static getLatestByOrderIds(orderIds, callback) {
    if (!orderIds || !orderIds.length) return callback(null, []);
    const placeholders = orderIds.map(() => '?').join(', ');
    const sql = `
      SELECT r.*
      FROM refund_requests r
      INNER JOIN (
        SELECT order_id, MAX(id) AS max_id
        FROM refund_requests
        WHERE order_id IN (${placeholders})
        GROUP BY order_id
      ) latest ON latest.max_id = r.id
    `;
    db.query(sql, orderIds, callback);
  }
}

module.exports = RefundRequestModel;
