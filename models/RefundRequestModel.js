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
}

module.exports = RefundRequestModel;
