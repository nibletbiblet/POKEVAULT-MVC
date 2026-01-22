const db = require('../db');

const Order = {
  // Create an order with items: orderData { userId, total }, items [{productId, productName, rarity, price, quantity, image}]
  create(orderData, items, callback) {
    const normalizedItems = (items || [])
      .map(it => ({
        productId: it.productId || it.id,
        productName: it.productName,
        rarity: it.rarity || it.category || null,
        price: it.price,
        quantity: Number(it.quantity) || 0,
        image: it.image || null
      }))
      .filter(it => it.productId && it.quantity > 0);

    if (!normalizedItems.length) {
      return callback(new Error('No items to place in order'));
    }

    const rollback = (err) => db.rollback(() => callback(err));

    db.beginTransaction(err => {
      if (err) return callback(err);

      // Lock relevant product rows to ensure stock consistency
      const lockSql = 'SELECT id, quantity, productName FROM products WHERE id IN (?) FOR UPDATE';
      const ids = normalizedItems.map(it => it.productId);

      db.query(lockSql, [ids], (err, rows) => {
        if (err) return rollback(err);

        const stockById = new Map(rows.map(r => [r.id, r.quantity]));
        const missing = normalizedItems.find(it => !stockById.has(it.productId));
        if (missing) return rollback(new Error(`Product not found: ${missing.productName || missing.productId}`));

        const insufficient = normalizedItems.find(it => stockById.get(it.productId) < it.quantity);
        if (insufficient) return rollback(new Error(`Not enough stock for ${insufficient.productName}`));

        const orderSql = 'INSERT INTO orders (userId, total, address, createdAt) VALUES (?, ?, ?, NOW())';
        db.query(orderSql, [orderData.userId, orderData.total, orderData.address || null], (err, orderResult) => {
          if (err) return rollback(err);
          const orderId = orderResult.insertId;

          const values = normalizedItems.map(it => [
            orderId,
            it.productId,
            it.productName,
            it.rarity,
            it.price,
            it.quantity,
            it.image
          ]);
          const itemsSql = 'INSERT INTO order_items (orderId, productId, productName, rarity, price, quantity, image) VALUES ?';

          db.query(itemsSql, [values], err => {
            if (err) return rollback(err);

            // Deduct stock sequentially to stay inside transaction
            const updateStock = (index) => {
              if (index >= normalizedItems.length) {
                return db.commit(err => {
                  if (err) return rollback(err);
                  callback(null, { orderId });
                });
              }
              const item = normalizedItems[index];
              const updateSql = 'UPDATE products SET quantity = quantity - ? WHERE id = ?';
              db.query(updateSql, [item.quantity, item.productId], (err) => {
                if (err) return rollback(err);
                updateStock(index + 1);
              });
            };

            updateStock(0);
          });
        });
      });
    });
  },

  getByUser(userId, callback) {
    const sql = 'SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC';
    db.query(sql, [userId], callback);
  },

  getWithItems(orderId, callback) {
    const orderSql = 'SELECT * FROM orders WHERE id = ?';
    const itemsSql = 'SELECT * FROM order_items WHERE orderId = ?';
    db.query(orderSql, [orderId], (err, orders) => {
      if (err) return callback(err);
      if (!orders || orders.length === 0) return callback(null, null);
      db.query(itemsSql, [orderId], (err, items) => {
        if (err) return callback(err);
        callback(null, { order: orders[0], items });
      });
    });
  },

  /**
   * Fetch all orders with their items and user info for admin audit log.
   */
  getAllWithItemsPaginated(page, pageSize, searchTerm, callback) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safeSize;
    const search = (searchTerm || '').trim();

    const baseFrom = `
      FROM orders o
      LEFT JOIN users u ON u.id = o.userId
      LEFT JOIN order_items oi ON oi.orderId = o.id`;

    const searchClause = search
      ? `WHERE (
          CAST(o.id AS CHAR) LIKE ?
          OR u.username LIKE ?
          OR u.email LIKE ?
          OR oi.productName LIKE ?
        )`
      : '';

    const like = `%${search}%`;
    const searchParams = search ? [like, like, like, like] : [];

    const countSql = `SELECT COUNT(DISTINCT o.id) AS total ${baseFrom} ${searchClause}`;
    db.query(countSql, searchParams, (err, countRows) => {
      if (err) return callback(err);
      const total = countRows[0]?.total || 0;
      if (!total) return callback(null, { orders: [], total, page: safePage, pageSize: safeSize });

      const orderSql = `
        SELECT DISTINCT o.id, o.userId, o.total, o.address, o.createdAt,
               u.username, u.email
        ${baseFrom}
        ${searchClause}
        ORDER BY o.createdAt DESC
        LIMIT ? OFFSET ?`;

      const orderParams = searchParams.concat([safeSize, offset]);

      db.query(orderSql, orderParams, (err, orders) => {
        if (err) return callback(err);
        if (!orders || !orders.length) return callback(null, { orders: [], total, page: safePage, pageSize: safeSize });

        const orderIds = orders.map(o => o.id);
        const itemsSql = `
          SELECT id, orderId, productId, productName, rarity, price, quantity
          FROM order_items
          WHERE orderId IN (?)
          ORDER BY orderId ASC, id ASC`;

        db.query(itemsSql, [orderIds], (err, items) => {
          if (err) return callback(err);

          const itemsByOrder = new Map();
          items.forEach(item => {
            if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
            itemsByOrder.get(item.orderId).push(item);
          });

          const hydrated = orders.map(order => {
            const orderItems = itemsByOrder.get(order.id) || [];
            const totalQuantity = orderItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
            const username = order.username || `Deleted user #${order.userId}`;
            const email = order.email || 'Unavailable';
            return { ...order, username, email, items: orderItems, totalQuantity };
          });

          callback(null, { orders: hydrated, total, page: safePage, pageSize: safeSize });
        });
      });
    });
  }
};

module.exports = Order;
