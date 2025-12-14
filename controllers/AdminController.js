const db = require('../db');
const Order = require('../models/Order');

// Promise wrapper to run SQL with async/await
const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

const AdminController = {
  listUsers(req, res) {
    const sql = 'SELECT id, username, email, role, contact, address FROM users ORDER BY id DESC';
    db.query(sql, (err, users) => {
      if (err) {
        console.error('Error fetching users:', err);
        return res.status(500).send('Database error');
      }
      res.render('adminUsers', { users, user: req.session.user });
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

  addUser(req, res) {
    const { username, email, password, address, contact, role } = req.body;
    const chosenRole = ['admin', 'user'].includes(role) ? role : 'user';

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

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    db.query(sql, [username, email, password, address, contact, chosenRole], (err) => {
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
    const chosenRole = ['admin', 'user'].includes(role) ? role : 'user';

    // Prevent editing other admin accounts
    const guardSql = 'SELECT id, role FROM users WHERE id = ?';
    db.query(guardSql, [userId], (err, rows) => {
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
        setParts.push('password = SHA1(?)');
        params.push(password);
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
    db.query(fetchSql, [userId], (err, rows) => {
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
        req.flash('error', 'Admin accounts cannot be deleted.');
        return res.redirect('/admin/users');
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
