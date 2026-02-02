/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: nate
 Student ID: 24025215
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const db = require('../db');

const Transaction = {
  create(data, callback) {
    const sql = `
      INSERT INTO transactions
      (orderId, paymentMethod, paymentStatus, paymentReference, amount)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(
      sql,
      [
        data.orderId,
        data.method,
        data.status,
        data.reference || null,
        data.amount
      ],
      callback
    );
  }
};

module.exports = Transaction;
