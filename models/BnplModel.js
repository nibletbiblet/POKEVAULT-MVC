/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const db = require('../db');

class BnplModel {
  static createInstallments(orderId, totalAmount, months, callback) {
    const installmentAmount = Number((totalAmount / months).toFixed(2));
    const installments = [];

    for (let i = 1; i <= months; i += 1) {
      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + i);
      installments.push([
        orderId,
        i,
        installmentAmount,
        dueDate.toISOString().split('T')[0]
      ]);
    }

    const sql = `
      INSERT INTO bnpl_installments
      (order_id, installment_no, amount, due_date)
      VALUES ?
    `;
    db.query(sql, [installments], callback);
  }

  static getInstallmentsByOrder(orderId, callback) {
    const sql = `
      SELECT *
      FROM bnpl_installments
      WHERE order_id = ?
      ORDER BY installment_no ASC
    `;
    db.query(sql, [orderId], callback);
  }
}

module.exports = BnplModel;
