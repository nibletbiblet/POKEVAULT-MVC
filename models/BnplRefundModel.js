/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const db = require('../db');

class BnplRefundModel {
  static createRequest(orderId, userId, reason, callback) {
    const sql = `
      INSERT INTO bnpl_refund_requests
      (order_id, user_id, reason)
      VALUES (?, ?, ?)
    `;
    db.query(sql, [orderId, userId, reason], callback);
  }

  static getByOrder(orderId, callback) {
    const sql = `
      SELECT *
      FROM bnpl_refund_requests
      WHERE order_id = ?
      LIMIT 1
    `;
    db.query(sql, [orderId], callback);
  }

  static getAll(callback) {
    const sql = `
      SELECT r.*, u.username
      FROM bnpl_refund_requests r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `;
    db.query(sql, callback);
  }

  static updateStatus(id, status, callback) {
    const sql = `
      UPDATE bnpl_refund_requests
      SET status = ?
      WHERE id = ?
    `;
    db.query(sql, [status, id], callback);
  }
}

module.exports = BnplRefundModel;
