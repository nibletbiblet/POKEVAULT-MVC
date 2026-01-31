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
