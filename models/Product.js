
/**
 * Function-based Product model (MVC)
 * Exports an object with methods that use a MySQL connection from ../db.
 * Each method accepts parameters and a callback(err, results).
 * Table fields assumed: id, productName, quantity, price, image, rarity
 */
/*<!--
 I declare that this code was written by me. 
 I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: Ray
 Student ID: 24026513
 Class: C372-003-E63C
 Date created: 20/1/2026
  -->*/

const Product = {
	getColumns(callback) {
		const db = require('../db');
		const sql = `
			SELECT COLUMN_NAME
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			  AND TABLE_NAME = 'products'
		`;
		db.query(sql, (err, rows) => {
			if (err) return callback(err);
			const cols = new Set((rows || []).map(r => String(r.COLUMN_NAME || '').toLowerCase()));
			return callback(null, cols);
		});
	},

	// Get all products
	getAll(callback) {
		const db = require('../db');
		const sql = 'SELECT * FROM products';
		db.query(sql, (err, results) => callback(err, results));
	},

	// Get only active products (fallback to all if schema doesn't support is_active)
	getActive(callback) {
		const db = require('../db');
		const sql = 'SELECT * FROM products';
		db.query(sql, (err, results) => callback(err, results));
	},

	// Get a single product by ID
	getById(id, callback) {
		const db = require('../db');
		const sql = 'SELECT * FROM products WHERE id = ?';
		db.query(sql, [id], (err, results) => callback(err, results && results[0] ? results[0] : null));
	},

	// Add a new product. `product` should be an object { productName, quantity, price, image }
	add(product, callback) {
		const db = require('../db');
		this.getColumns((colErr, cols) => {
			if (colErr) return callback(colErr);
			const columns = ['productName', 'quantity', 'price', 'discountPercent', 'image', 'rarity'];
			const params = [
				product.productName,
				product.quantity,
				product.price,
				product.discountPercent,
				product.image || null,
				product.rarity || null
			];
			if (cols.has('sellerid')) {
				columns.push('sellerId');
				params.push(product.sellerId || null);
			}
			if (cols.has('listingstatus')) {
				columns.push('listingStatus');
				params.push(product.listingStatus || 'PENDING');
			}
			if (cols.has('authenticitystatus')) {
				columns.push('authenticityStatus');
				params.push(product.authenticityStatus || 'PENDING');
			}
			const placeholders = columns.map(() => '?').join(', ');
			const sql = `INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders})`;
			db.query(sql, params, (err, result) => callback(err, result));
		});
	},

	// Update an existing product by ID. `product` same shape as add
	update(id, product, callback) {
		const db = require('../db');
		this.getColumns((colErr, cols) => {
			if (colErr) return callback(colErr);
			const setParts = [
				'productName = ?',
				'quantity = ?',
				'price = ?',
				'discountPercent = ?',
				'image = ?',
				'rarity = ?'
			];
			const params = [
				product.productName,
				product.quantity,
				product.price,
				product.discountPercent,
				product.image || null,
				product.rarity || null
			];
			if (cols.has('listingstatus') && product.listingStatus) {
				setParts.push('listingStatus = ?');
				params.push(product.listingStatus);
			}
			if (cols.has('authenticitystatus') && product.authenticityStatus) {
				setParts.push('authenticityStatus = ?');
				params.push(product.authenticityStatus);
			}
			params.push(id);
			const sql = `UPDATE products SET ${setParts.join(', ')} WHERE id = ?`;
			db.query(sql, params, (err, result) => callback(err, result));
		});
	},

	// Delete a product by ID (hard delete to support schemas without is_active)
	delete(id, callback) {
		const db = require('../db');
		const sql = 'DELETE FROM products WHERE id = ?';
		db.query(sql, [id], (err, result) => callback(err, result));
	},

	setActive(id, isActive, callback) {
		if (isActive) return callback(null, { affectedRows: 0 });
		return this.delete(id, callback);
	}
};

module.exports = Product;
