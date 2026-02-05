/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG ,nate
 Student ID: 24024323 ,24025215
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const db = require('../db');
const bcrypt = require('bcrypt');
const Order = require('../models/Order');
const UserBanHistory = require('../models/UserBanHistory');

const ALLOWED_ROLES = ['admin', 'storekeeper', 'user'];

// Promise wrapper to run SQL with async/await
const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

const AdminController = {
  async orderStatus(req, res) {
    try {
      let rows = [];
      try {
        rows = await runQuery(`
          SELECT
            o.id,
            o.userId,
            o.total,
            o.status,
            o.createdAt,
            u.username,
            u.email,
            oi.id AS itemId,
            oi.productId,
            oi.productName,
            oi.quantity,
            oi.image
          FROM orders o
          LEFT JOIN users u ON u.id = o.userId
          LEFT JOIN order_items oi ON oi.orderId = o.id
          ORDER BY o.createdAt DESC, oi.id ASC
        `);
      } catch (err) {
        if (err && err.code === 'ER_BAD_FIELD_ERROR' && String(err.sqlMessage || '').includes('status')) {
          rows = await runQuery(`
            SELECT
              o.id,
              o.userId,
              o.total,
              o.createdAt,
              u.username,
              u.email,
              oi.id AS itemId,
              oi.productId,
              oi.productName,
              oi.quantity,
              oi.image
            FROM orders o
            LEFT JOIN users u ON u.id = o.userId
            LEFT JOIN order_items oi ON oi.orderId = o.id
            ORDER BY o.createdAt DESC, oi.id ASC
          `);
        } else {
          throw err;
        }
      }

      const ordersById = new Map();
      rows.forEach(row => {
        if (!ordersById.has(row.id)) {
          ordersById.set(row.id, {
            id: row.id,
            userId: row.userId,
            total: Number(row.total || 0),
            status: row.status || 'TO_SHIP',
            createdAt: row.createdAt,
            username: row.username || `User #${row.userId}`,
            email: row.email || 'Unavailable',
            items: []
          });
        }
        if (row.itemId) {
          ordersById.get(row.id).items.push({
            id: row.itemId,
            productId: row.productId,
            productName: row.productName,
            quantity: Number(row.quantity) || 0,
            image: row.image || null
          });
        }
      });

      let refundRequests = [];
      try {
        refundRequests = await runQuery(`
          SELECT
            r.id,
            r.order_id,
            r.user_id,
            r.reason,
            r.description,
            r.status,
            r.created_at,
            o.total,
            o.status AS orderStatus,
            u.username,
            u.email
          FROM refund_requests r
          JOIN orders o ON o.id = r.order_id
          JOIN users u ON u.id = r.user_id
          WHERE r.status = 'PENDING'
          ORDER BY r.created_at DESC
        `);
      } catch (err) {
        if (err && err.code === 'ER_NO_SUCH_TABLE' && String(err.sqlMessage || '').includes('refund_requests')) {
          refundRequests = [];
        } else if (err && err.code === 'ER_BAD_FIELD_ERROR' && String(err.sqlMessage || '').includes('status')) {
          refundRequests = await runQuery(`
            SELECT
              r.id,
              r.order_id,
              r.user_id,
              r.reason,
              r.description,
              r.status,
              r.created_at,
              o.total,
              u.username,
              u.email
            FROM refund_requests r
            JOIN orders o ON o.id = r.order_id
            JOIN users u ON u.id = r.user_id
            WHERE r.status = 'PENDING'
            ORDER BY r.created_at DESC
          `);
        } else {
          throw err;
        }
      }

      res.render('adminOrderStatus', {
        user: req.session.user,
        orders: Array.from(ordersById.values()),
        refundRequests
      });
    } catch (err) {
      console.error('Error loading order status:', err);
      res.status(500).send('Database error');
    }
  },

  async refundRequestsPage(req, res) {
    try {
      let refundRequests = [];
      try {
        refundRequests = await runQuery(`
          SELECT
            r.id,
            r.order_id,
            r.user_id,
            r.reason,
            r.description,
            r.status,
            r.created_at,
            o.total,
            o.status AS orderStatus,
            u.username,
            u.email
          FROM refund_requests r
          JOIN orders o ON o.id = r.order_id
          JOIN users u ON u.id = r.user_id
          WHERE r.status = 'PENDING'
          ORDER BY r.created_at DESC
        `);
      } catch (err) {
        if (err && err.code === 'ER_NO_SUCH_TABLE' && String(err.sqlMessage || '').includes('refund_requests')) {
          refundRequests = [];
        } else if (err && err.code === 'ER_BAD_FIELD_ERROR' && String(err.sqlMessage || '').includes('status')) {
          refundRequests = await runQuery(`
            SELECT
              r.id,
              r.order_id,
              r.user_id,
              r.reason,
              r.description,
              r.status,
              r.created_at,
              o.total,
              u.username,
              u.email
            FROM refund_requests r
            JOIN orders o ON o.id = r.order_id
            JOIN users u ON u.id = r.user_id
            WHERE r.status = 'PENDING'
            ORDER BY r.created_at DESC
          `);
        } else {
          throw err;
        }
      }

      res.render('adminRefunds', {
        user: req.session.user,
        refundRequests
      });
    } catch (err) {
      console.error('Error loading refund requests:', err);
      res.status(500).send('Database error');
    }
  },

  adminSendOrder(req, res) {
    const orderId = req.params.id;
    Order.getById(orderId, (err, order) => {
      if (err || !order) return res.status(404).send('Order not found');
      if (order.status !== 'TO_SHIP') {
        req.flash('error', 'Order is not ready to ship.');
        return res.redirect('/admin/orders-status');
      }

      Order.updateStatus(orderId, 'TO_RECEIVE', (err2) => {
        if (err2) return res.status(500).send('Failed to update order status');
        req.flash('success', `Order #${orderId} marked as shipped.`);
        return res.redirect('/admin/orders-status');
      });
    });
  },
  listUsers(req, res) {
    const sql = 'SELECT id, username, email, role, contact, address, isBanned FROM users ORDER BY id DESC';
    db.query(sql, (err, users) => {
      if (err) {
        console.error('Error fetching users:', err);
        return res.status(500).send('Database error');
      }
      res.render('adminUsers', { users, user: req.session.user });
    });
  },

  banUser(req, res) {
    const userId = req.params.id;
    const reasonRaw = typeof req.body.banReason === 'string' ? req.body.banReason.trim() : '';
    const reason = reasonRaw || null;
    const adminId = req.session && req.session.user ? req.session.user.id : null;
    const guardSql = 'SELECT id, role FROM users WHERE id = ?';
    db.query(guardSql, [userId], (guardErr, rows) => {
      if (guardErr) {
        console.error('Error checking user role:', guardErr);
        req.flash('error', 'Could not ban user.');
        return res.redirect('/admin/users');
      }
      if (!rows || !rows.length) {
        req.flash('error', 'User not found.');
        return res.redirect('/admin/users');
      }
      if (rows[0].role === 'admin') {
        req.flash('error', 'Admin accounts cannot be banned.');
        return res.redirect('/admin/users');
      }

      const sql = 'UPDATE users SET isBanned = 1, banReason = ?, bannedAt = NOW(), bannedBy = ? WHERE id = ?';
      db.query(sql, [reason, adminId, userId], (err) => {
        if (err) {
          console.error('Error banning user:', err);
          req.flash('error', 'Could not ban user.');
          return res.redirect('/admin/users');
        }
        UserBanHistory.create(
          { userId, action: 'BAN', reason, adminId },
          (histErr) => {
            if (histErr) console.error('Error recording ban history:', histErr);
            req.flash('success', 'User banned.');
            return res.redirect('/admin/users');
          }
        );
      });
    });
  },

  unbanUser(req, res) {
    const userId = req.params.id;
    const guardSql = 'SELECT id, role FROM users WHERE id = ?';
    db.query(guardSql, [userId], (guardErr, rows) => {
      if (guardErr) {
        console.error('Error checking user role:', guardErr);
        req.flash('error', 'Could not unban user.');
        return res.redirect('/admin/users');
      }
      if (!rows || !rows.length) {
        req.flash('error', 'User not found.');
        return res.redirect('/admin/users');
      }
      if (rows[0].role === 'admin') {
        req.flash('error', 'Admin accounts cannot be unbanned.');
        return res.redirect('/admin/users');
      }

      const sql = 'UPDATE users SET isBanned = 0, banReason = NULL, bannedAt = NULL, bannedBy = NULL WHERE id = ?';
      db.query(sql, [userId], (err) => {
        if (err) {
          console.error('Error unbanning user:', err);
          req.flash('error', 'Could not unban user.');
          return res.redirect('/admin/users');
        }
        const adminId = req.session && req.session.user ? req.session.user.id : null;
        UserBanHistory.create(
          { userId, action: 'UNBAN', reason: null, adminId },
          (histErr) => {
            if (histErr) console.error('Error recording unban history:', histErr);
            req.flash('success', 'User unbanned.');
            return res.redirect('/admin/users');
          }
        );
      });
    });
  },

  userOrders(req, res) {
    const userId = req.params.id;
    const userSql = 'SELECT id, username, email FROM users WHERE id = ?';
    db.query(userSql, [userId], (err, result) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).send('Database error');
      }
      if (!result || !result.length) return res.status(404).send('User not found');
      const targetUser = result[0];
      Order.getByUser(userId, (err, orders) => {
        if (err) {
          console.error('Error fetching orders:', err);
          return res.status(500).send('Database error');
        }
        res.render('adminUserOrders', { targetUser, orders, user: req.session.user });
      });
    });
  },

  suspensionHistory(req, res) {
    const userId = req.params.id;
    const userSql = 'SELECT id, username, email FROM users WHERE id = ?';
    db.query(userSql, [userId], (err, result) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).send('Database error');
      }
      if (!result || !result.length) return res.status(404).send('User not found');
      const targetUser = result[0];
      UserBanHistory.getByUserId(userId, (histErr, history) => {
        if (histErr) {
          console.error('Error fetching user ban history:', histErr);
        }
        res.render('adminUserSuspension', {
          targetUser,
          history: history || [],
          user: req.session.user
        });
      });
    });
  },

  addUserForm(req, res) {
    const formData = req.flash('formData')[0];
    const messages = req.flash('error');
    const success = req.flash('success');
    res.render('adminUserForm', {
      user: req.session.user,
      targetUser: null,
      isEdit: false,
      formData,
      messages,
      success
    });
  },

  async addUser(req, res) {
    const { username, email, password, address, contact, role } = req.body;
    const chosenRole = ALLOWED_ROLES.includes(role) ? role : 'user';

    if (!username || !email || !password || !address || !contact) {
      req.flash('error', 'All fields are required.');
      req.flash('formData', req.body);
      return res.redirect('/admin/users/add');
    }
    if (password.length < 6) {
      req.flash('error', 'Password should be at least 6 characters.');
      req.flash('formData', req.body);
      return res.redirect('/admin/users/add');
    }

    let existingUsers = [];
    try {
      existingUsers = await runQuery('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    } catch (err) {
      console.error('Error checking existing email:', err);
      req.flash('error', 'Could not create user.');
      req.flash('formData', req.body);
      return res.redirect('/admin/users/add');
    }

    if (existingUsers.length > 0) {
      req.flash('error', 'Email already registered. Please use another email.');
      req.flash('formData', req.body);
      return res.redirect('/admin/users/add');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [username, email, passwordHash, address, contact, chosenRole], (err) => {
      if (err) {
        console.error('Error adding user:', err);
        req.flash('error', 'Could not create user.');
        req.flash('formData', req.body);
        return res.redirect('/admin/users/add');
      }
      req.flash('success', 'User created successfully.');
      return res.redirect('/admin/users');
    });
  },

  editUserForm(req, res) {
    const userId = req.params.id;
    const formData = req.flash('formData')[0];
    const messages = req.flash('error');
    const success = req.flash('success');
    const sql = 'SELECT id, username, email, role, contact, address FROM users WHERE id = ?';
    db.query(sql, [userId], (err, rows) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).send('Database error');
      }
      if (!rows || !rows.length) return res.status(404).send('User not found');
      const targetUser = rows[0];
      const isSelf = req.session.user && req.session.user.id === targetUser.id;
      if (targetUser.role === 'admin' && !isSelf) {
        req.flash('error', 'Admin accounts cannot be edited by other admins.');
        return res.redirect('/admin/users');
      }
      res.render('adminUserForm', {
        user: req.session.user,
        targetUser,
        isEdit: true,
        formData,
        messages,
        success
      });
    });
  },

  editUser(req, res) {
    const userId = req.params.id;
    const { username, email, password, address, contact, role } = req.body;
    const chosenRole = ALLOWED_ROLES.includes(role) ? role : 'user';

    // Prevent editing other admin accounts
    const guardSql = 'SELECT id, role FROM users WHERE id = ?';
    db.query(guardSql, [userId], async (err, rows) => {
      if (err) {
        console.error('Error checking user role:', err);
        req.flash('error', 'Could not update user.');
        req.flash('formData', { ...req.body, password: '' });
        return res.redirect(`/admin/users/${userId}/edit`);
      }
      if (!rows || !rows.length) {
        req.flash('error', 'User not found.');
        return res.redirect('/admin/users');
      }
      const target = rows[0];
      const isSelf = req.session.user && req.session.user.id === target.id;
      if (target.role === 'admin' && !isSelf) {
        req.flash('error', 'Admin accounts cannot be edited by other admins.');
        return res.redirect('/admin/users');
      }
      if (target.role === 'admin' && chosenRole !== 'admin') {
        const adminCountRows = await runQuery('SELECT COUNT(*) AS total FROM users WHERE role = "admin"');
        const adminCount = adminCountRows[0]?.total || 0;
        if (adminCount <= 1) {
          req.flash('error', 'Cannot remove the last remaining admin.');
          return res.redirect(`/admin/users/${userId}/edit`);
        }
      }

      if (!username || !email || !address || !contact) {
        req.flash('error', 'Username, email, address, and contact are required.');
        req.flash('formData', { ...req.body, password: '' });
        return res.redirect(`/admin/users/${userId}/edit`);
      }
      if (password && password.length < 6) {
        req.flash('error', 'Password should be at least 6 characters.');
        req.flash('formData', { ...req.body, password: '' });
        return res.redirect(`/admin/users/${userId}/edit`);
      }

      const setParts = [
        'username = ?',
        'email = ?',
        'address = ?',
        'contact = ?',
        'role = ?'
      ];
      const params = [username, email, address, contact, chosenRole];
      if (password) {
        const passwordHash = await bcrypt.hash(password, 10);
        setParts.push('password = ?');
        params.push(passwordHash);
      }
      params.push(userId);

      const sql = `UPDATE users SET ${setParts.join(', ')} WHERE id = ?`;
      db.query(sql, params, (err) => {
        if (err) {
          console.error('Error updating user:', err);
          req.flash('error', 'Could not update user.');
          req.flash('formData', { ...req.body, password: '' });
          return res.redirect(`/admin/users/${userId}/edit`);
        }
        req.flash('success', 'User updated successfully.');
        return res.redirect('/admin/users');
      });
    });

  },

  deleteUser(req, res) {
    const userId = req.params.id;
    const fetchSql = 'SELECT id, username, role FROM users WHERE id = ?';
    db.query(fetchSql, [userId], async (err, rows) => {
      if (err) {
        console.error('Error checking user for deletion:', err);
        req.flash('error', 'Could not delete user.');
        return res.redirect('/admin/users');
      }
      if (!rows || !rows.length) {
        req.flash('error', 'User not found.');
        return res.redirect('/admin/users');
      }

      const target = rows[0];
      if (target.role === 'admin') {
        const adminCountRows = await runQuery('SELECT COUNT(*) AS total FROM users WHERE role = "admin"');
        const adminCount = adminCountRows[0]?.total || 0;
        if (adminCount <= 1) {
          req.flash('error', 'Cannot remove the last remaining admin.');
          return res.redirect('/admin/users');
        }
      }

      const sql = 'DELETE FROM users WHERE id = ?';
      db.query(sql, [userId], (err) => {
        if (err) {
          console.error('Error deleting user:', err);
          req.flash('error', 'Could not delete user.');
        }
        res.redirect('/admin/users');
      });
    });
  },

  auditLog(req, res) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;
    const q = (req.query.q || '').trim();
    Order.getAllWithItemsPaginated(page, pageSize, q, (err, result) => {
      if (err) {
        console.error('Error fetching audit log:', err);
        return res.status(500).send('Database error');
      }
      const totalPages = Math.max(1, Math.ceil((result.total || 0) / pageSize));
      res.render('auditLog', {
        orders: result.orders,
        user: req.session.user,
        page: result.page,
        totalPages,
        total: result.total,
        q
      });
    });
  },

  async dashboard(req, res) {
    try {
      const success = req.flash('success');
      const [
        usersRow,
        ordersRow,
        revenueRow,
        productsRow,
        tradesRow,
        bestProduct,
        bestCustomer,
        recentOrders,
        revenueByDay
      ] = await Promise.all([
        runQuery('SELECT COUNT(*) AS totalUsers FROM users'),
        runQuery('SELECT COUNT(*) AS totalOrders FROM orders'),
        runQuery('SELECT COALESCE(SUM(total),0) AS revenue FROM orders'),
        runQuery('SELECT COUNT(*) AS totalProducts FROM products'),
        runQuery('SELECT COUNT(*) AS totalTrades FROM trades'),
        runQuery(`
          SELECT productId, productName, SUM(quantity) AS qty, SUM(price * quantity) AS revenue
          FROM order_items
          GROUP BY productId, productName
          ORDER BY qty DESC
          LIMIT 1
        `),
        runQuery(`
          SELECT u.id, u.username, u.email, COALESCE(SUM(o.total),0) AS totalSpent, COUNT(o.id) AS orderCount
          FROM orders o
          JOIN users u ON u.id = o.userId
          GROUP BY o.userId
          ORDER BY totalSpent DESC
          LIMIT 1
        `),
        runQuery(`
          SELECT o.id, o.total, o.createdAt, u.username, u.email
          FROM orders o
          JOIN users u ON u.id = o.userId
          ORDER BY o.createdAt DESC
          LIMIT 5
        `),
        runQuery(`
          SELECT DATE(createdAt) AS day, SUM(total) AS revenue
          FROM orders
          WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
          GROUP BY DATE(createdAt)
          ORDER BY day ASC
        `)
      ]);

      const stats = {
        totalUsers: usersRow[0]?.totalUsers || 0,
        totalOrders: ordersRow[0]?.totalOrders || 0,
        revenue: Number(revenueRow[0]?.revenue || 0),
        totalProducts: productsRow[0]?.totalProducts || 0,
        totalTrades: tradesRow[0]?.totalTrades || 0,
        bestProduct: bestProduct[0] || null,
        bestCustomer: bestCustomer[0] || null,
        recentOrders,
        revenueByDay: (revenueByDay || []).map(r => ({
          day: r.day ? new Date(r.day).toISOString().slice(0, 10) : '',
          revenue: Number(r.revenue || 0)
        }))
      };

      res.render('adminDashboard', { user: req.session.user, stats, success });
    } catch (err) {
      console.error('Error building dashboard:', err);
      res.status(500).send('Database error');
    }
  },

  async trades(req, res) {
    try {
      const trades = await runQuery(`
        SELECT
          t.*,
          u1.username AS initiatorUsername,
          u2.username AS responderUsername,
          p1.productName AS initiatorProductName,
          p2.productName AS responderProductName
        FROM trades t
        LEFT JOIN users u1 ON t.initiator_id = u1.id
        LEFT JOIN users u2 ON t.responder_id = u2.id
        LEFT JOIN products p1 ON t.initiator_product_id = p1.id
        LEFT JOIN products p2 ON t.responder_product_id = p2.id
        ORDER BY t.updated_at DESC, t.created_at DESC
      `);

      const statusCounts = trades.reduce((acc, t) => {
        const key = t.status || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      res.render('adminTrades', {
        user: req.session.user,
        trades,
        statusCounts
      });
    } catch (err) {
      console.error('Error loading trades for admin:', err);
      res.status(500).send('Database error');
    }
  }
};

module.exports = AdminController;
