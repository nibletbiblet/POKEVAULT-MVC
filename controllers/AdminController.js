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
const { logAdminActivity } = require('../services/adminActivity');
const {
  normalizeRangeKey,
  getRangeWindow,
  computeDeltaPercent,
  buildValueMap,
  fillSeries,
  enumerateDays,
  enumerateWeeks,
  enumerateMonths
} = require('../services/dashboardMetrics');

const ALLOWED_ROLES = ['admin', 'storekeeper', 'user'];
const COMPLIANCE_HIGH_VALUE_THRESHOLD = 500;
const COMPLIANCE_REFUND_RATE_THRESHOLD = 0.5;
const COMPLIANCE_VELOCITY_COUNT = 3;
const COMPLIANCE_VELOCITY_MINUTES = 10;

// Promise wrapper to run SQL with async/await
const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

const runQueryWithFallbacks = async (queries) => {
  let lastErr = null;
  for (const q of queries) {
    try {
      const rows = await runQuery(q.sql, q.params || []);
      return { rows, sql: q.sql };
    } catch (err) {
      lastErr = err;
      if (err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE')) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
};

const toDateRange = (dateStr) => {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

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
      const filterUserId = req.query && req.query.userId ? Number(req.query.userId) : null;
      try {
        refundRequests = await runQuery(
          `
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
            ${filterUserId ? 'WHERE r.user_id = ?' : "WHERE r.status = 'PENDING'"}
            ORDER BY r.created_at DESC
          `,
          filterUserId ? [filterUserId] : []
        );
      } catch (err) {
        if (err && err.code === 'ER_NO_SUCH_TABLE' && String(err.sqlMessage || '').includes('refund_requests')) {
          refundRequests = [];
        } else if (err && err.code === 'ER_BAD_FIELD_ERROR' && String(err.sqlMessage || '').includes('status')) {
          refundRequests = await runQuery(
            `
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
              ${filterUserId ? 'WHERE r.user_id = ?' : "WHERE r.status = 'PENDING'"}
              ORDER BY r.created_at DESC
            `,
            filterUserId ? [filterUserId] : []
          );
        } else {
          throw err;
        }
      }

      const pendingCounts = new Map();
      (refundRequests || []).forEach(r => {
        if (r.status === 'PENDING') {
          pendingCounts.set(r.user_id, (pendingCounts.get(r.user_id) || 0) + 1);
        }
      });
      const flaggedUsers = [];
      pendingCounts.forEach((count, userId) => {
        if (count >= 2) {
          const sample = (refundRequests || []).find(r => r.user_id === userId) || {};
          flaggedUsers.push({
            userId,
            username: sample.username || `User #${userId}`,
            email: sample.email || '',
            count
          });
        }
      });

      res.render('adminRefunds', {
        user: req.session.user,
        refundRequests,
        flaggedUsers,
        filterUserId
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
        logAdminActivity(req, 'ORDER_STATUS_UPDATE', 'order', orderId, { status: 'TO_RECEIVE' });
        req.flash('success', `Order #${orderId} marked as shipped.`);
        return res.redirect('/admin/orders-status');
      });
    });
  },
  async listUsers(req, res) {
    const kycFilter = req.query && typeof req.query.kyc === 'string' ? req.query.kyc.trim() : '';
    const refundRateMin = req.query && req.query.refundRate ? Number(req.query.refundRate) : null;
    const highValueNoKyc = req.query && req.query.highValueNoKyc === '1';
    const velocityFlag = req.query && req.query.velocity === '1';

    let users = [];
    let hasKycStatus = false;
    try {
      const baseResult = await runQueryWithFallbacks([
        { sql: 'SELECT id, username, email, role, contact, address, isBanned, kycStatus FROM users WHERE (isDeleted = 0 OR isDeleted IS NULL) ORDER BY id DESC' },
        { sql: 'SELECT id, username, email, role, contact, address, isBanned FROM users WHERE (isDeleted = 0 OR isDeleted IS NULL) ORDER BY id DESC' }
      ]);
      users = baseResult.rows || [];
      hasKycStatus = /kycstatus/i.test(baseResult.sql || '');
    } catch (err) {
      console.error('Error fetching users:', err);
      return res.status(500).send('Database error');
    }

    const userIds = (users || []).map(u => u.id);
    if (!userIds.length) {
      return res.render('adminUsers', { users, user: req.session.user });
    }

    const placeholders = userIds.map(() => '?').join(', ');
    let statsRows = [];
    try {
      statsRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT
              u.id AS userId,
              COUNT(DISTINCT o.id) AS totalOrders,
              COUNT(DISTINCT rr.order_id) AS refundOrders
            FROM users u
            LEFT JOIN orders o ON o.userId = u.id
            LEFT JOIN refund_requests rr ON rr.user_id = u.id AND rr.status = 'APPROVED'
            WHERE u.id IN (${placeholders})
              AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
              AND (o.status IN ('paid','completed','COMPLETED') OR o.id IS NULL)
            GROUP BY u.id
          `,
          params: userIds
        },
        {
          sql: `
            SELECT
              u.id AS userId,
              COUNT(DISTINCT o.id) AS totalOrders,
              COUNT(DISTINCT rr.order_id) AS refundOrders
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            LEFT JOIN refund_requests rr ON rr.user_id = u.id AND rr.status = 'APPROVED'
            WHERE u.id IN (${placeholders})
              AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
              AND (o.status IN ('paid','completed','COMPLETED') OR o.id IS NULL)
            GROUP BY u.id
          `,
          params: userIds
        },
        {
          sql: `
            SELECT
              u.id AS userId,
              COUNT(DISTINCT o.id) AS totalOrders,
              COUNT(DISTINCT rr.order_id) AS refundOrders
            FROM users u
            LEFT JOIN orders o ON o.userId = u.id
            LEFT JOIN refund_requests rr ON rr.user_id = u.id
            WHERE u.id IN (${placeholders})
              AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
            GROUP BY u.id
          `,
          params: userIds
        },
        {
          sql: `
            SELECT
              u.id AS userId,
              COUNT(DISTINCT o.id) AS totalOrders,
              COUNT(DISTINCT rr.order_id) AS refundOrders
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            LEFT JOIN refund_requests rr ON rr.user_id = u.id
            WHERE u.id IN (${placeholders})
              AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
            GROUP BY u.id
          `,
          params: userIds
        },
        {
          sql: `
            SELECT
              u.id AS userId,
              COUNT(DISTINCT o.id) AS totalOrders,
              0 AS refundOrders
            FROM users u
            LEFT JOIN orders o ON o.userId = u.id
            WHERE u.id IN (${placeholders})
              AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
              AND (o.status IN ('paid','completed','COMPLETED') OR o.id IS NULL)
            GROUP BY u.id
          `,
          params: userIds
        },
        {
          sql: `
            SELECT
              u.id AS userId,
              COUNT(DISTINCT o.id) AS totalOrders,
              0 AS refundOrders
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            WHERE u.id IN (${placeholders})
              AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
              AND (o.status IN ('paid','completed','COMPLETED') OR o.id IS NULL)
            GROUP BY u.id
          `,
          params: userIds
        }
      ]).then(r => r.rows);
    } catch (statsErr) {
      console.error('Error computing refund stats:', statsErr);
      return res.render('adminUsers', { users, user: req.session.user });
    }

    const statsByUser = new Map();
    (statsRows || []).forEach(r => {
      const total = Number(r.totalOrders || 0);
      const refundOrders = Number(r.refundOrders || 0);
      const refundRate = total > 0 ? refundOrders / total : 0;
      statsByUser.set(r.userId, { refundRate, total, refundOrders });
    });
    let enriched = (users || []).map(u => {
      const stats = statsByUser.get(u.id) || { refundRate: 0, total: 0, refundOrders: 0 };
      return {
        ...u,
        refundRate: stats.refundRate,
        refundOrders: stats.refundOrders,
        totalOrders: stats.total
      };
    });

    if (kycFilter && hasKycStatus) {
      if (kycFilter === 'incomplete') {
        const incomplete = new Set(['NOT_STARTED', 'PENDING', 'REJECTED']);
        enriched = enriched.filter(u => incomplete.has(String(u.kycStatus || '').toUpperCase()));
      } else if (kycFilter === 'verified') {
        enriched = enriched.filter(u => String(u.kycStatus || '').toUpperCase() === 'VERIFIED');
      } else {
        enriched = enriched.filter(u => String(u.kycStatus || '').toUpperCase() === kycFilter.toUpperCase());
      }
    }

    if (Number.isFinite(refundRateMin)) {
      enriched = enriched.filter(u => Number(u.refundRate || 0) >= refundRateMin);
    }

    if (highValueNoKyc) {
      try {
        const rows = await runQueryWithFallbacks([
          {
            sql: `
              SELECT DISTINCT o.userId AS userId
              FROM orders o
              JOIN users u ON u.id = o.userId
              WHERE o.total >= ?
                AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
                AND (u.kycStatus IS NULL OR u.kycStatus <> 'VERIFIED')
            `,
            params: [COMPLIANCE_HIGH_VALUE_THRESHOLD]
          },
          {
            sql: `
              SELECT DISTINCT o.user_id AS userId
              FROM orders o
              JOIN users u ON u.id = o.user_id
              WHERE o.total >= ?
                AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
                AND (u.kycStatus IS NULL OR u.kycStatus <> 'VERIFIED')
            `,
            params: [COMPLIANCE_HIGH_VALUE_THRESHOLD]
          }
        ]).then(r => r.rows);
        const flagged = new Set((rows || []).map(r => r.userId));
        enriched = enriched.filter(u => flagged.has(u.id));
      } catch (err) {
        console.error('Error filtering high value KYC users:', err);
      }
    }

    if (velocityFlag) {
      try {
        const rows = await runQueryWithFallbacks([
          {
            sql: `
              SELECT DISTINCT userId FROM (
                SELECT o1.userId AS userId
                FROM orders o1
                JOIN users u ON u.id = o1.userId
                JOIN orders o2
                  ON o2.userId = o1.userId
                 AND o2.createdAt BETWEEN o1.createdAt AND DATE_ADD(o1.createdAt, INTERVAL ? MINUTE)
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                GROUP BY o1.userId, o1.id
                HAVING COUNT(o2.id) >= ?
              ) t
            `,
            params: [COMPLIANCE_VELOCITY_MINUTES, COMPLIANCE_VELOCITY_COUNT]
          },
          {
            sql: `
              SELECT DISTINCT userId FROM (
                SELECT o1.user_id AS userId
                FROM orders o1
                JOIN users u ON u.id = o1.user_id
                JOIN orders o2
                  ON o2.user_id = o1.user_id
                 AND o2.created_at BETWEEN o1.created_at AND DATE_ADD(o1.created_at, INTERVAL ? MINUTE)
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                GROUP BY o1.user_id, o1.id
                HAVING COUNT(o2.id) >= ?
              ) t
            `,
            params: [COMPLIANCE_VELOCITY_MINUTES, COMPLIANCE_VELOCITY_COUNT]
          }
        ]).then(r => r.rows);
        const flagged = new Set((rows || []).map(r => r.userId));
        enriched = enriched.filter(u => flagged.has(u.id));
      } catch (err) {
        console.error('Error filtering velocity users:', err);
      }
    }

    return res.render('adminUsers', { users: enriched, user: req.session.user });
  },

  banUser(req, res) {
    const userId = req.params.id;
    const reasonRaw = typeof req.body.banReason === 'string' ? req.body.banReason.trim() : '';
    const reason = reasonRaw || null;
    const adminId = req.session && req.session.user ? req.session.user.id : null;
    const guardSql = 'SELECT id, role FROM users WHERE id = ? AND (isDeleted = 0 OR isDeleted IS NULL)';
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
            logAdminActivity(req, 'USER_BAN', 'user', userId, { reason });
            req.flash('success', 'User banned.');
            return res.redirect('/admin/users');
          }
        );
      });
    });
  },

  unbanUser(req, res) {
    const userId = req.params.id;
    const guardSql = 'SELECT id, role FROM users WHERE id = ? AND (isDeleted = 0 OR isDeleted IS NULL)';
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
            logAdminActivity(req, 'USER_UNBAN', 'user', userId, {});
            req.flash('success', 'User unbanned.');
            return res.redirect('/admin/users');
          }
        );
      });
    });
  },

  userOrders(req, res) {
    const userId = req.params.id;
    const userSql = 'SELECT id, username, email FROM users WHERE id = ? AND (isDeleted = 0 OR isDeleted IS NULL)';
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
    const userSql = 'SELECT id, username, email FROM users WHERE id = ? AND (isDeleted = 0 OR isDeleted IS NULL)';
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
      existingUsers = await runQuery('SELECT id FROM users WHERE email = ? AND (isDeleted = 0 OR isDeleted IS NULL) LIMIT 1', [email]);
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
      logAdminActivity(req, 'USER_CREATE', 'user', null, { email, username, role: chosenRole });
      req.flash('success', 'User created successfully.');
      return res.redirect('/admin/users');
    });
  },

  editUserForm(req, res) {
    const userId = req.params.id;
    const formData = req.flash('formData')[0];
    const messages = req.flash('error');
    const success = req.flash('success');
    const sql = 'SELECT id, username, email, role, contact, address FROM users WHERE id = ? AND (isDeleted = 0 OR isDeleted IS NULL)';
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
    const guardSql = 'SELECT id, role FROM users WHERE id = ? AND (isDeleted = 0 OR isDeleted IS NULL)';
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
        const adminCountRows = await runQuery('SELECT COUNT(*) AS total FROM users WHERE role = "admin" AND (isDeleted = 0 OR isDeleted IS NULL)');
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
        logAdminActivity(req, 'USER_UPDATE', 'user', userId, { username, email, role: chosenRole });
        req.flash('success', 'User updated successfully.');
        return res.redirect('/admin/users');
      });
    });

  },

  deleteUser(req, res) {
    const userId = req.params.id;
    const fetchSql = 'SELECT id, username, role FROM users WHERE id = ? AND (isDeleted = 0 OR isDeleted IS NULL)';
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
        const adminCountRows = await runQuery('SELECT COUNT(*) AS total FROM users WHERE role = "admin" AND (isDeleted = 0 OR isDeleted IS NULL)');
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
        } else {
          logAdminActivity(req, 'USER_DELETE', 'user', userId, { username: target.username });
        }
        res.redirect('/admin/users');
      });
    });
  },

  async adminKyc(req, res) {
    try {
      const rows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT id, username, email, kycStatus, kycUpdatedAt
            FROM users
            WHERE kycStatus = 'PENDING'
            ORDER BY kycUpdatedAt DESC
          `
        }
      ]).then(r => r.rows);

      res.render('adminKyc', {
        user: req.session.user,
        users: rows || [],
        messages: req.flash('error'),
        success: req.flash('success')
      });
    } catch (err) {
      if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR')) {
        return res.render('adminKyc', {
          user: req.session.user,
          users: [],
          messages: ['KYC is not available yet.'],
          success: []
        });
      }
      console.error('Error loading KYC queue:', err);
      return res.status(500).send('Database error');
    }
  },

  adminKycApprove(req, res) {
    const adminId = req.session && req.session.user ? req.session.user.id : null;
    const userId = req.params.userId;
    const sql = `
      UPDATE users
      SET kycStatus = 'VERIFIED',
          kycUpdatedAt = NOW(),
          kycReviewedBy = ?,
          kycRejectionReason = NULL
      WHERE id = ?
    `;
    db.query(sql, [adminId, userId], (err) => {
      if (err) {
        console.error('Error approving KYC:', err);
        req.flash('error', 'Could not approve KYC.');
        return res.redirect('/admin/kyc');
      }
      req.flash('success', 'KYC approved.');
      return res.redirect('/admin/kyc');
    });
  },

  adminKycReject(req, res) {
    const adminId = req.session && req.session.user ? req.session.user.id : null;
    const userId = req.params.userId;
    const reason = (req.body.reason || '').trim();
    const sql = `
      UPDATE users
      SET kycStatus = 'REJECTED',
          kycUpdatedAt = NOW(),
          kycReviewedBy = ?,
          kycRejectionReason = ?
      WHERE id = ?
    `;
    db.query(sql, [adminId, reason || null, userId], (err) => {
      if (err) {
        console.error('Error rejecting KYC:', err);
        req.flash('error', 'Could not reject KYC.');
        return res.redirect('/admin/kyc');
      }
      req.flash('success', 'KYC rejected.');
      return res.redirect('/admin/kyc');
    });
  },

  async adminActivity(req, res) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;
    const q = String(req.query.q || '').trim();
    const adminIdFilter = req.query && req.query.adminId ? Number(req.query.adminId) : null;
    const offset = (page - 1) * pageSize;
    const like = `%${q}%`;

    const baseSql = `
      FROM admin_activity a
      LEFT JOIN users u ON u.id = a.admin_id
    `;
    const whereParts = [];
    const params = [];
    if (q) {
      whereParts.push('a.action LIKE ? OR a.entity_type LIKE ? OR u.username LIKE ? OR a.details LIKE ?');
      params.push(like, like, like, like);
    }
    if (Number.isFinite(adminIdFilter)) {
      whereParts.push('a.admin_id = ?');
      params.push(adminIdFilter);
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    try {
      const totalRows = await runQuery(
        `SELECT COUNT(*) AS total ${baseSql} ${whereSql}`,
        params
      );
      const total = Number(totalRows[0]?.total || 0);
      const rows = await runQuery(
        `
          SELECT
            a.id,
            a.admin_id AS adminId,
            u.username,
            a.action,
            a.entity_type AS entityType,
            a.entity_id AS entityId,
            a.details,
            a.ip,
            a.user_agent AS userAgent,
            a.created_at AS createdAt
          ${baseSql}
          ${whereSql}
          ORDER BY a.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [...params, pageSize, offset]
      );
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return res.render('adminActivity', {
        user: req.session.user,
        rows,
        page,
        totalPages,
        total,
        q,
        adminIdFilter
      });
    } catch (err) {
      if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR')) {
        return res.render('adminActivity', {
          user: req.session.user,
          rows: [],
          page: 1,
          totalPages: 1,
          total: 0,
          q,
          adminIdFilter
        });
      }
      console.error('Error fetching admin activity:', err);
      return res.status(500).send('Database error');
    }
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
      const rangeKey = normalizeRangeKey(req.query.range);
      const range = getRangeWindow(rangeKey, new Date());
      let rangeStart = range.rangeStart;
      let rangeEnd = range.rangeEnd;
      let days = range.days;

      if (rangeKey === 'ALL') {
        const minDateRows = await runQueryWithFallbacks([
          {
            sql: `
              SELECT MIN(d) AS minDate
              FROM (
                SELECT MIN(createdAt) AS d FROM transactions WHERE paymentStatus = 'COMPLETED'
                UNION ALL
                SELECT MIN(createdAt) AS d FROM transactions WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
              ) x
            `
          },
          {
            sql: `
              SELECT MIN(d) AS minDate
              FROM (
                SELECT MIN(createdAt) AS d FROM orders
                UNION ALL
                SELECT MIN(created_at) AS d FROM refund_requests
              ) x
            `
          },
          {
            sql: `
              SELECT MIN(d) AS minDate
              FROM (
                SELECT MIN(createdAt) AS d FROM orders
              ) x
            `
          }
        ]).then(r => r.rows);
        const minDate = minDateRows[0]?.minDate ? new Date(minDateRows[0].minDate) : null;
        rangeStart = minDate ? new Date(minDate) : new Date(rangeEnd);
        rangeStart.setHours(0, 0, 0, 0);
        days = enumerateDays(rangeStart, rangeEnd);
      }

      const buildRangeParams = (start, end) => (start && end ? [start, end] : []);
      const rangeParams = buildRangeParams(rangeStart, rangeEnd);
      const prevParams = buildRangeParams(range.prevStart, range.prevEnd);

      const grossSqlBase = `SELECT COALESCE(SUM(total),0) AS value
        FROM orders
        WHERE status IN ('paid','completed','COMPLETED')`;
      const refundsSqlBase = `SELECT COALESCE(SUM(o.total),0) AS value
        FROM refund_requests r
        JOIN orders o ON o.id = r.order_id
        WHERE r.status = 'APPROVED'`;
      const ordersSqlBase = `SELECT COUNT(*) AS value
        FROM orders
        WHERE status IN ('paid','completed','COMPLETED')`;
      const usersSqlBase = `SELECT COUNT(*) AS value FROM users WHERE (isDeleted = 0 OR isDeleted IS NULL)`;
      const tradesSqlBase = `SELECT COUNT(*) AS value FROM trades`;

      const grossSql = rangeStart ? `${grossSqlBase} AND createdAt >= ? AND createdAt < ?` : grossSqlBase;
      const refundsSql = rangeStart ? `${refundsSqlBase} AND r.created_at >= ? AND r.created_at < ?` : refundsSqlBase;
      const ordersSql = rangeStart ? `${ordersSqlBase} AND createdAt >= ? AND createdAt < ?` : ordersSqlBase;
      const usersSql = rangeStart ? `${usersSqlBase} AND createdAt >= ? AND createdAt < ?` : usersSqlBase;
      const tradesSql = rangeStart ? `${tradesSqlBase} WHERE created_at >= ? AND created_at < ?` : tradesSqlBase;

      const grossAllSql = grossSqlBase;
      const refundsAllSql = refundsSqlBase;

      const [
        grossRows,
        refundRows,
        orderCountRows,
        userCountRows,
        tradeCountRows,
        grossAllRows,
        refundAllRows,
        recentOrders
      ] = await Promise.all([
        runQueryWithFallbacks([
          {
            sql: `SELECT COALESCE(SUM(amount),0) AS value
              FROM transactions
              WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'${rangeStart ? ' AND createdAt >= ? AND createdAt < ?' : ''}`,
            params: rangeParams
          },
          { sql: grossSql, params: rangeParams }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          {
            sql: `SELECT COALESCE(SUM(amount),0) AS value
              FROM transactions
              WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'${rangeStart ? ' AND createdAt >= ? AND createdAt < ?' : ''}`,
            params: rangeParams
          },
          { sql: refundsSql, params: rangeParams }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          { sql: ordersSql, params: rangeParams },
          { sql: `${ordersSqlBase} AND created_at >= ? AND created_at < ?`, params: rangeParams }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          { sql: usersSql, params: rangeParams },
          { sql: `${usersSqlBase} AND created_at >= ? AND created_at < ?`, params: rangeParams },
          { sql: usersSqlBase }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          { sql: tradesSql, params: rangeParams },
          { sql: tradesSqlBase }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          { sql: `SELECT COALESCE(SUM(amount),0) AS value FROM transactions WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'` },
          { sql: grossAllSql }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          { sql: `SELECT COALESCE(SUM(amount),0) AS value FROM transactions WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'` },
          { sql: refundsAllSql }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          {
            sql: `
              SELECT o.id, o.total, o.createdAt, o.status, u.username, u.email
              FROM orders o
              LEFT JOIN users u ON u.id = o.userId
              ORDER BY o.createdAt DESC
              LIMIT 5
            `
          },
          {
            sql: `
              SELECT o.id, o.total, o.created_at AS createdAt, o.status, u.username, u.email
              FROM orders o
              LEFT JOIN users u ON u.id = o.user_id
              ORDER BY o.created_at DESC
              LIMIT 5
            `
          }
        ]).then(r => r.rows)
      ]);

      const grossSales = Number(grossRows[0]?.value || 0);
      const refundedAmount = Number(refundRows[0]?.value || 0);
      const netSales = grossSales - refundedAmount;
      const totalOrders = Number(orderCountRows[0]?.value || 0);
      const totalUsers = Number(userCountRows[0]?.value || 0);
      const totalTrades = Number(tradeCountRows[0]?.value || 0);
      const allTimeNetSales = Number(grossAllRows[0]?.value || 0) - Number(refundAllRows[0]?.value || 0);

      let prevGrossSales = null;
      let prevRefundedAmount = null;
      let prevNetSales = null;
      let prevOrders = null;
      let prevUsers = null;
      let prevTrades = null;

      if (range.prevStart && range.prevEnd) {
        const [
          grossPrevRows,
          refundPrevRows,
          orderPrevRows,
          userPrevRows,
          tradePrevRows
        ] = await Promise.all([
          runQueryWithFallbacks([
            {
              sql: `SELECT COALESCE(SUM(amount),0) AS value
                FROM transactions
                WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'
                  AND createdAt >= ? AND createdAt < ?`,
              params: prevParams
            },
            { sql: `${grossSqlBase} AND createdAt >= ? AND createdAt < ?`, params: prevParams },
            { sql: `${grossSqlBase} AND created_at >= ? AND created_at < ?`, params: prevParams }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            {
              sql: `SELECT COALESCE(SUM(amount),0) AS value
                FROM transactions
                WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
                  AND createdAt >= ? AND createdAt < ?`,
              params: prevParams
            },
            { sql: `${refundsSqlBase} AND r.created_at >= ? AND r.created_at < ?`, params: prevParams }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            { sql: `${ordersSqlBase} AND createdAt >= ? AND createdAt < ?`, params: prevParams },
            { sql: `${ordersSqlBase} AND created_at >= ? AND created_at < ?`, params: prevParams }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            { sql: `${usersSqlBase} AND createdAt >= ? AND createdAt < ?`, params: prevParams },
            { sql: `${usersSqlBase} AND created_at >= ? AND created_at < ?`, params: prevParams },
            { sql: usersSqlBase }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            { sql: `${tradesSqlBase} WHERE created_at >= ? AND created_at < ?`, params: prevParams },
            { sql: tradesSqlBase }
          ]).then(r => r.rows)
        ]);
        prevGrossSales = Number(grossPrevRows[0]?.value || 0);
        prevRefundedAmount = Number(refundPrevRows[0]?.value || 0);
        prevNetSales = prevGrossSales - prevRefundedAmount;
        prevOrders = Number(orderPrevRows[0]?.value || 0);
        prevUsers = Number(userPrevRows[0]?.value || 0);
        prevTrades = Number(tradePrevRows[0]?.value || 0);
      }

      const grossDelta = computeDeltaPercent(grossSales, prevGrossSales);
      const refundDelta = computeDeltaPercent(refundedAmount, prevRefundedAmount);
      const netDelta = computeDeltaPercent(netSales, prevNetSales);
      const ordersDelta = computeDeltaPercent(totalOrders, prevOrders);
      const usersDelta = computeDeltaPercent(totalUsers, prevUsers);
      const tradesDelta = computeDeltaPercent(totalTrades, prevTrades);

      const aov = totalOrders > 0 ? netSales / totalOrders : null;
      const refundRate = grossSales > 0 ? refundedAmount / grossSales : null;

      const alignSeries = (series, targetLength) => {
        const out = [];
        for (let i = 0; i < targetLength; i += 1) {
          out.push(series && series[i] !== undefined ? series[i] : null);
        }
        return out;
      };

      const groupUnit = rangeKey === 'YTD' ? 'WEEK' : rangeKey === 'ALL' ? 'MONTH' : 'DAY';
      const groupByLabel = groupUnit === 'WEEK' ? 'Week' : groupUnit === 'MONTH' ? 'Month' : 'Day';
      let chartPayload = { labels: [], current: {}, previous: {}, groupByLabel };

      let labels = days;
      let prevLabels = range.prevDays;
      if (groupUnit === 'WEEK') {
        labels = enumerateWeeks(rangeStart, rangeEnd);
        prevLabels = range.prevStart && range.prevEnd ? enumerateWeeks(range.prevStart, range.prevEnd) : [];
      } else if (groupUnit === 'MONTH') {
        labels = enumerateMonths(rangeStart, rangeEnd);
        prevLabels = range.prevStart && range.prevEnd ? enumerateMonths(range.prevStart, range.prevEnd) : [];
      }

      if (labels && labels.length) {
        const bucketExpr = (col) => {
          if (groupUnit === 'WEEK') return `DATE_FORMAT(${col}, '%x-W%v')`;
          if (groupUnit === 'MONTH') return `DATE_FORMAT(${col}, '%Y-%m')`;
          return `DATE(${col})`;
        };
        const [
          grossByDayRows,
          refundByDayRows,
          ordersByDayRows
        ] = await Promise.all([
          runQueryWithFallbacks([
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
                FROM transactions
                WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: rangeParams
            },
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(total),0) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: rangeParams
            },
            {
              sql: `
                SELECT ${bucketExpr('created_at')} AS bucket, COALESCE(SUM(total),0) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND created_at >= ? AND created_at < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: rangeParams
            }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
                FROM transactions
                WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: rangeParams
            },
            {
              sql: `
                SELECT ${bucketExpr('r.created_at')} AS bucket, COALESCE(SUM(o.total),0) AS value
                FROM refund_requests r
                JOIN orders o ON o.id = r.order_id
                WHERE r.status = 'APPROVED'
                  AND r.created_at >= ? AND r.created_at < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: rangeParams
            }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COUNT(*) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: rangeParams
            },
            {
              sql: `
                SELECT ${bucketExpr('created_at')} AS bucket, COUNT(*) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND created_at >= ? AND created_at < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: rangeParams
            }
          ]).then(r => r.rows)
        ]);

        const grossMap = buildValueMap(grossByDayRows, 'value');
        const refundMap = buildValueMap(refundByDayRows, 'value');
        const ordersMap = buildValueMap(ordersByDayRows, 'value');

        const grossSeries = fillSeries(labels, grossMap, 0);
        const refundSeries = fillSeries(labels, refundMap, 0);
        const netSeries = grossSeries.map((v, idx) => v - refundSeries[idx]);
        const ordersSeries = fillSeries(labels, ordersMap, 0);

        let prevNetSeries = [];
        let prevRefundSeries = [];
        let prevOrdersSeries = [];

        if (range.prevStart && range.prevEnd) {
          const [
            grossPrevByDayRows,
            refundPrevByDayRows,
            ordersPrevByDayRows
          ] = await Promise.all([
            runQueryWithFallbacks([
              {
                sql: `
                  SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
                  FROM transactions
                  WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'
                    AND createdAt >= ? AND createdAt < ?
                  GROUP BY bucket
                  ORDER BY bucket ASC
                `,
                params: prevParams
              },
              {
                sql: `
                  SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(total),0) AS value
                  FROM orders
                  WHERE status IN ('paid','completed','COMPLETED')
                    AND createdAt >= ? AND createdAt < ?
                  GROUP BY bucket
                  ORDER BY bucket ASC
                `,
                params: prevParams
              },
              {
                sql: `
                  SELECT ${bucketExpr('created_at')} AS bucket, COALESCE(SUM(total),0) AS value
                  FROM orders
                  WHERE status IN ('paid','completed','COMPLETED')
                    AND created_at >= ? AND created_at < ?
                  GROUP BY bucket
                  ORDER BY bucket ASC
                `,
                params: prevParams
              }
            ]).then(r => r.rows),
            runQueryWithFallbacks([
              {
                sql: `
                  SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
                  FROM transactions
                  WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
                    AND createdAt >= ? AND createdAt < ?
                  GROUP BY bucket
                  ORDER BY bucket ASC
                `,
                params: prevParams
              },
              {
                sql: `
                  SELECT ${bucketExpr('r.created_at')} AS bucket, COALESCE(SUM(o.total),0) AS value
                  FROM refund_requests r
                  JOIN orders o ON o.id = r.order_id
                  WHERE r.status = 'APPROVED'
                    AND r.created_at >= ? AND r.created_at < ?
                  GROUP BY bucket
                  ORDER BY bucket ASC
                `,
                params: prevParams
              }
            ]).then(r => r.rows),
            runQueryWithFallbacks([
              {
                sql: `
                  SELECT ${bucketExpr('createdAt')} AS bucket, COUNT(*) AS value
                  FROM orders
                  WHERE status IN ('paid','completed','COMPLETED')
                    AND createdAt >= ? AND createdAt < ?
                  GROUP BY bucket
                  ORDER BY bucket ASC
                `,
                params: prevParams
              },
              {
                sql: `
                  SELECT ${bucketExpr('created_at')} AS bucket, COUNT(*) AS value
                  FROM orders
                  WHERE status IN ('paid','completed','COMPLETED')
                    AND created_at >= ? AND created_at < ?
                  GROUP BY bucket
                  ORDER BY bucket ASC
                `,
                params: prevParams
              }
            ]).then(r => r.rows)
          ]);

          const grossPrevMap = buildValueMap(grossPrevByDayRows, 'value');
          const refundPrevMap = buildValueMap(refundPrevByDayRows, 'value');
          const ordersPrevMap = buildValueMap(ordersPrevByDayRows, 'value');
          const grossPrevSeries = fillSeries(prevLabels, grossPrevMap, 0);
          prevRefundSeries = fillSeries(prevLabels, refundPrevMap, 0);
          prevNetSeries = grossPrevSeries.map((v, idx) => v - prevRefundSeries[idx]);
          prevOrdersSeries = fillSeries(prevLabels, ordersPrevMap, 0);
        }

        chartPayload = {
          labels,
          current: {
            net_sales: netSeries,
            orders: ordersSeries,
            refunds: refundSeries
          },
          previous: {
            net_sales: alignSeries(prevNetSeries, labels.length),
            orders: alignSeries(prevOrdersSeries, labels.length),
            refunds: alignSeries(prevRefundSeries, labels.length)
          },
          groupByLabel
        };
      }

      const safeCount = async (queries) => {
        try {
          const result = await runQueryWithFallbacks(queries);
          const row = result && result.rows && result.rows[0] ? result.rows[0] : {};
          const val = Number(row.value ?? row.total ?? row.count ?? 0);
          return Number.isFinite(val) ? val : 0;
        } catch (err) {
          if (err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE')) {
            return null;
          }
          throw err;
        }
      };

      const compliance = {
        incompleteKyc: await safeCount([
          {
            sql: `
              SELECT COUNT(*) AS value
              FROM users
              WHERE (isDeleted = 0 OR isDeleted IS NULL)
                AND kycStatus IN ('NOT_STARTED','PENDING','REJECTED')
            `
          }
        ]),
        highRefundRateUsers: await safeCount([
          {
            sql: `
              SELECT COUNT(*) AS value FROM (
                SELECT
                  u.id,
                  COUNT(DISTINCT o.id) AS totalOrders,
                  COUNT(DISTINCT rr.order_id) AS refundOrders
                FROM users u
                LEFT JOIN orders o ON o.userId = u.id
                LEFT JOIN refund_requests rr ON rr.user_id = u.id AND rr.status = 'APPROVED'
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                  AND (o.status IN ('paid','completed','COMPLETED') OR o.id IS NULL)
                GROUP BY u.id
                HAVING totalOrders > 0 AND refundOrders / totalOrders >= ?
              ) t
            `,
            params: [COMPLIANCE_REFUND_RATE_THRESHOLD]
          },
          {
            sql: `
              SELECT COUNT(*) AS value FROM (
                SELECT
                  u.id,
                  COUNT(DISTINCT o.id) AS totalOrders,
                  COUNT(DISTINCT rr.order_id) AS refundOrders
                FROM users u
                LEFT JOIN orders o ON o.user_id = u.id
                LEFT JOIN refund_requests rr ON rr.user_id = u.id AND rr.status = 'APPROVED'
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                  AND (o.status IN ('paid','completed','COMPLETED') OR o.id IS NULL)
                GROUP BY u.id
                HAVING totalOrders > 0 AND refundOrders / totalOrders >= ?
              ) t
            `,
            params: [COMPLIANCE_REFUND_RATE_THRESHOLD]
          },
          {
            sql: `
              SELECT COUNT(*) AS value FROM (
                SELECT
                  u.id,
                  COUNT(DISTINCT o.id) AS totalOrders,
                  COUNT(DISTINCT rr.order_id) AS refundOrders
                FROM users u
                LEFT JOIN orders o ON o.userId = u.id
                LEFT JOIN refund_requests rr ON rr.user_id = u.id
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                GROUP BY u.id
                HAVING totalOrders > 0 AND refundOrders / totalOrders >= ?
              ) t
            `,
            params: [COMPLIANCE_REFUND_RATE_THRESHOLD]
          },
          {
            sql: `
              SELECT COUNT(*) AS value FROM (
                SELECT
                  u.id,
                  COUNT(DISTINCT o.id) AS totalOrders,
                  COUNT(DISTINCT rr.order_id) AS refundOrders
                FROM users u
                LEFT JOIN orders o ON o.user_id = u.id
                LEFT JOIN refund_requests rr ON rr.user_id = u.id
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                GROUP BY u.id
                HAVING totalOrders > 0 AND refundOrders / totalOrders >= ?
              ) t
            `,
            params: [COMPLIANCE_REFUND_RATE_THRESHOLD]
          }
        ]),
        highValueNoKycOrders: await safeCount([
          {
            sql: `
              SELECT COUNT(*) AS value
              FROM orders o
              JOIN users u ON u.id = o.userId
              WHERE o.total >= ?
                AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
                AND (u.kycStatus IS NULL OR u.kycStatus <> 'VERIFIED')
            `,
            params: [COMPLIANCE_HIGH_VALUE_THRESHOLD]
          },
          {
            sql: `
              SELECT COUNT(*) AS value
              FROM orders o
              JOIN users u ON u.id = o.user_id
              WHERE o.total >= ?
                AND (u.isDeleted = 0 OR u.isDeleted IS NULL)
                AND (u.kycStatus IS NULL OR u.kycStatus <> 'VERIFIED')
            `,
            params: [COMPLIANCE_HIGH_VALUE_THRESHOLD]
          }
        ]),
        velocityUsers: await safeCount([
          {
            sql: `
              SELECT COUNT(DISTINCT userId) AS value FROM (
                SELECT o1.userId AS userId
                FROM orders o1
                JOIN users u ON u.id = o1.userId
                JOIN orders o2
                  ON o2.userId = o1.userId
                 AND o2.createdAt BETWEEN o1.createdAt AND DATE_ADD(o1.createdAt, INTERVAL ? MINUTE)
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                GROUP BY o1.userId, o1.id
                HAVING COUNT(o2.id) >= ?
              ) t
            `,
            params: [COMPLIANCE_VELOCITY_MINUTES, COMPLIANCE_VELOCITY_COUNT]
          },
          {
            sql: `
              SELECT COUNT(DISTINCT userId) AS value FROM (
                SELECT o1.user_id AS userId
                FROM orders o1
                JOIN users u ON u.id = o1.user_id
                JOIN orders o2
                  ON o2.user_id = o1.user_id
                 AND o2.created_at BETWEEN o1.created_at AND DATE_ADD(o1.created_at, INTERVAL ? MINUTE)
                WHERE (u.isDeleted = 0 OR u.isDeleted IS NULL)
                GROUP BY o1.user_id, o1.id
                HAVING COUNT(o2.id) >= ?
              ) t
            `,
            params: [COMPLIANCE_VELOCITY_MINUTES, COMPLIANCE_VELOCITY_COUNT]
          }
        ]),
        thresholds: {
          highValue: COMPLIANCE_HIGH_VALUE_THRESHOLD,
          refundRate: COMPLIANCE_REFUND_RATE_THRESHOLD,
          velocityCount: COMPLIANCE_VELOCITY_COUNT,
          velocityMinutes: COMPLIANCE_VELOCITY_MINUTES
        },
        windowLabel: 'All time'
      };

      const stats = {
        rangeKey,
        rangeLabel: range.rangeLabel,
        prevLabel: range.prevLabel,
        grossSales,
        refundedAmount,
        netSales,
        totalOrders,
        totalUsers,
        totalTrades,
        allTimeNetSales,
        deltas: {
          grossSales: grossDelta,
          refundedAmount: refundDelta,
          netSales: netDelta,
          orders: ordersDelta,
          users: usersDelta,
          trades: tradesDelta
        },
        ratios: {
          aov,
          refundRate
        },
        chart: chartPayload,
        recentOrders,
        compliance
      };

      res.render('adminDashboard', { user: req.session.user, stats, success });
    } catch (err) {
      console.error('Error building dashboard:', err);
      res.status(500).send('Database error');
    }
  },

  async dashboardCsv(req, res) {
    try {
      const rangeKey = normalizeRangeKey(req.query.range);
      const range = getRangeWindow(rangeKey, new Date());
      let rangeStart = range.rangeStart;
      let rangeEnd = range.rangeEnd;
      let days = range.days;

      if (rangeKey === 'ALL') {
        const minDateRows = await runQueryWithFallbacks([
          {
            sql: `
              SELECT MIN(d) AS minDate
              FROM (
                SELECT MIN(createdAt) AS d FROM transactions WHERE paymentStatus = 'COMPLETED'
                UNION ALL
                SELECT MIN(createdAt) AS d FROM transactions WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
              ) x
            `
          },
          {
            sql: `
              SELECT MIN(d) AS minDate
              FROM (
                SELECT MIN(createdAt) AS d FROM orders
                UNION ALL
                SELECT MIN(created_at) AS d FROM refund_requests
              ) x
            `
          },
          {
            sql: `
              SELECT MIN(d) AS minDate
              FROM (
                SELECT MIN(createdAt) AS d FROM orders
              ) x
            `
          }
        ]).then(r => r.rows);
        const minDate = minDateRows[0]?.minDate ? new Date(minDateRows[0].minDate) : null;
        rangeStart = minDate ? new Date(minDate) : new Date(rangeEnd);
        rangeStart.setHours(0, 0, 0, 0);
        days = enumerateDays(rangeStart, rangeEnd);
      }

      const buildRangeParams = (start, end) => (start && end ? [start, end] : []);
      const rangeParams = buildRangeParams(rangeStart, rangeEnd);
      const prevParams = buildRangeParams(range.prevStart, range.prevEnd);

      const groupUnit = rangeKey === 'YTD' ? 'WEEK' : rangeKey === 'ALL' ? 'MONTH' : 'DAY';
      let labels = days;
      let prevLabels = range.prevDays;
      if (groupUnit === 'WEEK') {
        labels = enumerateWeeks(rangeStart, rangeEnd);
        prevLabels = range.prevStart && range.prevEnd ? enumerateWeeks(range.prevStart, range.prevEnd) : [];
      } else if (groupUnit === 'MONTH') {
        labels = enumerateMonths(rangeStart, rangeEnd);
        prevLabels = range.prevStart && range.prevEnd ? enumerateMonths(range.prevStart, range.prevEnd) : [];
      }

      const bucketExpr = (col) => {
        if (groupUnit === 'WEEK') return `DATE_FORMAT(${col}, '%x-W%v')`;
        if (groupUnit === 'MONTH') return `DATE_FORMAT(${col}, '%Y-%m')`;
        return `DATE(${col})`;
      };

      const [
        grossByDayRows,
        refundByDayRows,
        ordersByDayRows
      ] = await Promise.all([
        runQueryWithFallbacks([
          {
            sql: `
              SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
              FROM transactions
              WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'
                AND createdAt >= ? AND createdAt < ?
              GROUP BY bucket
              ORDER BY bucket ASC
            `,
            params: rangeParams
          },
          {
            sql: `
              SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(total),0) AS value
              FROM orders
              WHERE status IN ('paid','completed','COMPLETED')
                AND createdAt >= ? AND createdAt < ?
              GROUP BY bucket
              ORDER BY bucket ASC
            `,
            params: rangeParams
          },
          {
            sql: `
              SELECT ${bucketExpr('created_at')} AS bucket, COALESCE(SUM(total),0) AS value
              FROM orders
              WHERE status IN ('paid','completed','COMPLETED')
                AND created_at >= ? AND created_at < ?
              GROUP BY bucket
              ORDER BY bucket ASC
            `,
            params: rangeParams
          }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          {
            sql: `
              SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
              FROM transactions
              WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
                AND createdAt >= ? AND createdAt < ?
              GROUP BY bucket
              ORDER BY bucket ASC
            `,
            params: rangeParams
          },
          {
            sql: `
              SELECT ${bucketExpr('r.created_at')} AS bucket, COALESCE(SUM(o.total),0) AS value
              FROM refund_requests r
              JOIN orders o ON o.id = r.order_id
              WHERE r.status = 'APPROVED'
                AND r.created_at >= ? AND r.created_at < ?
              GROUP BY bucket
              ORDER BY bucket ASC
            `,
            params: rangeParams
          }
        ]).then(r => r.rows),
        runQueryWithFallbacks([
          {
            sql: `
              SELECT ${bucketExpr('createdAt')} AS bucket, COUNT(*) AS value
              FROM orders
              WHERE status IN ('paid','completed','COMPLETED')
                AND createdAt >= ? AND createdAt < ?
              GROUP BY bucket
              ORDER BY bucket ASC
            `,
            params: rangeParams
          },
          {
            sql: `
              SELECT ${bucketExpr('created_at')} AS bucket, COUNT(*) AS value
              FROM orders
              WHERE status IN ('paid','completed','COMPLETED')
                AND created_at >= ? AND created_at < ?
              GROUP BY bucket
              ORDER BY bucket ASC
            `,
            params: rangeParams
          }
        ]).then(r => r.rows)
      ]);

      const grossMap = buildValueMap(grossByDayRows, 'value');
      const refundMap = buildValueMap(refundByDayRows, 'value');
      const ordersMap = buildValueMap(ordersByDayRows, 'value');

      const grossSeries = fillSeries(labels, grossMap, 0);
      const refundSeries = fillSeries(labels, refundMap, 0);
      const netSeries = grossSeries.map((v, idx) => v - refundSeries[idx]);
      const ordersSeries = fillSeries(labels, ordersMap, 0);

      let prevNetSeries = [];
      let prevRefundSeries = [];
      let prevOrdersSeries = [];

      if (range.prevStart && range.prevEnd) {
        const [
          grossPrevByDayRows,
          refundPrevByDayRows,
          ordersPrevByDayRows
        ] = await Promise.all([
          runQueryWithFallbacks([
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
                FROM transactions
                WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: prevParams
            },
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(total),0) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: prevParams
            },
            {
              sql: `
                SELECT ${bucketExpr('created_at')} AS bucket, COALESCE(SUM(total),0) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND created_at >= ? AND created_at < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: prevParams
            }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COALESCE(SUM(amount),0) AS value
                FROM transactions
                WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: prevParams
            },
            {
              sql: `
                SELECT ${bucketExpr('r.created_at')} AS bucket, COALESCE(SUM(o.total),0) AS value
                FROM refund_requests r
                JOIN orders o ON o.id = r.order_id
                WHERE r.status = 'APPROVED'
                  AND r.created_at >= ? AND r.created_at < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: prevParams
            }
          ]).then(r => r.rows),
          runQueryWithFallbacks([
            {
              sql: `
                SELECT ${bucketExpr('createdAt')} AS bucket, COUNT(*) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND createdAt >= ? AND createdAt < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: prevParams
            },
            {
              sql: `
                SELECT ${bucketExpr('created_at')} AS bucket, COUNT(*) AS value
                FROM orders
                WHERE status IN ('paid','completed','COMPLETED')
                  AND created_at >= ? AND created_at < ?
                GROUP BY bucket
                ORDER BY bucket ASC
              `,
              params: prevParams
            }
          ]).then(r => r.rows)
        ]);

        const grossPrevMap = buildValueMap(grossPrevByDayRows, 'value');
        const refundPrevMap = buildValueMap(refundPrevByDayRows, 'value');
        const ordersPrevMap = buildValueMap(ordersPrevByDayRows, 'value');
        const grossPrevSeries = fillSeries(prevLabels, grossPrevMap, 0);
        prevRefundSeries = fillSeries(prevLabels, refundPrevMap, 0);
        prevNetSeries = grossPrevSeries.map((v, idx) => v - prevRefundSeries[idx]);
        prevOrdersSeries = fillSeries(prevLabels, ordersPrevMap, 0);
      }

      const alignSeries = (series, targetLength) => {
        const out = [];
        for (let i = 0; i < targetLength; i += 1) {
          out.push(series && series[i] !== undefined ? series[i] : null);
        }
        return out;
      };

      const prevNetAligned = alignSeries(prevNetSeries, labels.length);
      const prevOrdersAligned = alignSeries(prevOrdersSeries, labels.length);
      const prevRefundAligned = alignSeries(prevRefundSeries, labels.length);

      const escapeCsv = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (/[",\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const lines = [];
      lines.push('bucket,net_sales,orders,refunds,prev_net_sales,prev_orders,prev_refunds');
      labels.forEach((label, idx) => {
        lines.push([
          escapeCsv(label),
          netSeries[idx] ?? '',
          ordersSeries[idx] ?? '',
          refundSeries[idx] ?? '',
          prevNetAligned[idx] ?? '',
          prevOrdersAligned[idx] ?? '',
          prevRefundAligned[idx] ?? ''
        ].join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="dashboard-report.csv"');
      return res.send(lines.join('\n'));
    } catch (err) {
      console.error('Error exporting dashboard CSV:', err);
      return res.status(500).send('Database error');
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
  ,
  async dailyReport(req, res) {
    try {
      const date = String(req.query.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).send('Invalid date');
      }

      const { start, end } = toDateRange(date);
      const ordersPage = Math.max(1, parseInt(req.query.ordersPage, 10) || 1);
      const refundsPage = Math.max(1, parseInt(req.query.refundsPage, 10) || 1);
      const pageSize = 10;
      const ordersOffset = (ordersPage - 1) * pageSize;
      const refundsOffset = (refundsPage - 1) * pageSize;

      const grossRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT COALESCE(SUM(amount),0) AS value
            FROM transactions
            WHERE paymentStatus = 'COMPLETED' AND paymentMethod <> 'REFUND'
              AND createdAt >= ? AND createdAt < ?
          `,
          params: [start, end]
        },
        {
          sql: `
            SELECT COALESCE(SUM(total),0) AS value
            FROM orders
            WHERE status IN ('paid','completed','COMPLETED')
              AND createdAt >= ? AND createdAt < ?
          `,
          params: [start, end]
        },
        {
          sql: `
            SELECT COALESCE(SUM(total),0) AS value
            FROM orders
            WHERE status IN ('paid','completed','COMPLETED')
              AND created_at >= ? AND created_at < ?
          `,
          params: [start, end]
        }
      ]).then(r => r.rows);

      const refundRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT COALESCE(SUM(amount),0) AS value
            FROM transactions
            WHERE paymentStatus = 'COMPLETED' AND paymentMethod = 'REFUND'
              AND createdAt >= ? AND createdAt < ?
          `,
          params: [start, end]
        },
        {
          sql: `
            SELECT COALESCE(SUM(o.total),0) AS value
            FROM refund_requests r
            JOIN orders o ON o.id = r.order_id
            WHERE r.status = 'APPROVED'
              AND r.created_at >= ? AND r.created_at < ?
          `,
          params: [start, end]
        }
      ]).then(r => r.rows);

      const ordersCountRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT COUNT(*) AS value
            FROM orders
            WHERE status IN ('paid','completed','COMPLETED')
              AND createdAt >= ? AND createdAt < ?
          `,
          params: [start, end]
        },
        {
          sql: `
            SELECT COUNT(*) AS value
            FROM orders
            WHERE status IN ('paid','completed','COMPLETED')
              AND created_at >= ? AND created_at < ?
          `,
          params: [start, end]
        }
      ]).then(r => r.rows);

      const grossSales = Number(grossRows[0]?.value || 0);
      const refundedAmount = Number(refundRows[0]?.value || 0);
      const netSales = grossSales - refundedAmount;
      const orderCount = Number(ordersCountRows[0]?.value || 0);
      const aov = orderCount > 0 ? netSales / orderCount : null;

      const ordersTotalRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT COUNT(*) AS total
            FROM orders
            WHERE status IN ('paid','completed','COMPLETED')
              AND createdAt >= ? AND createdAt < ?
          `,
          params: [start, end]
        },
        {
          sql: `
            SELECT COUNT(*) AS total
            FROM orders
            WHERE status IN ('paid','completed','COMPLETED')
              AND created_at >= ? AND created_at < ?
          `,
          params: [start, end]
        }
      ]).then(r => r.rows);
      const ordersTotal = Number(ordersTotalRows[0]?.total || 0);
      const ordersTotalPages = Math.max(1, Math.ceil(ordersTotal / pageSize));

      const ordersRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT o.id, o.userId, o.total, o.createdAt, o.status, u.username, u.email
            FROM orders o
            LEFT JOIN users u ON u.id = o.userId
            WHERE o.status IN ('paid','completed','COMPLETED')
              AND o.createdAt >= ? AND o.createdAt < ?
            ORDER BY o.createdAt DESC
            LIMIT ? OFFSET ?
          `,
          params: [start, end, pageSize, ordersOffset]
        },
        {
          sql: `
            SELECT o.id, o.user_id AS userId, o.total, o.created_at AS createdAt, o.status, u.username, u.email
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            WHERE o.status IN ('paid','completed','COMPLETED')
              AND o.created_at >= ? AND o.created_at < ?
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
          `,
          params: [start, end, pageSize, ordersOffset]
        }
      ]).then(r => r.rows);

      const refundsTotalRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT COUNT(*) AS total
            FROM transactions t
            WHERE t.paymentStatus = 'COMPLETED' AND t.paymentMethod = 'REFUND'
              AND t.createdAt >= ? AND t.createdAt < ?
          `,
          params: [start, end]
        },
        {
          sql: `
            SELECT COUNT(*) AS total
            FROM refund_requests r
            WHERE r.status = 'APPROVED'
              AND r.created_at >= ? AND r.created_at < ?
          `,
          params: [start, end]
        }
      ]).then(r => r.rows);
      const refundsTotal = Number(refundsTotalRows[0]?.total || 0);
      const refundsTotalPages = Math.max(1, Math.ceil(refundsTotal / pageSize));

      const refundsRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT t.id AS refund_id, t.orderId AS order_id, o.userId AS user_id, u.username, u.email,
                   t.amount, t.paymentStatus AS status, t.createdAt AS createdAt
            FROM transactions t
            JOIN orders o ON o.id = t.orderId
            JOIN users u ON u.id = o.userId
            WHERE t.paymentStatus = 'COMPLETED' AND t.paymentMethod = 'REFUND'
              AND t.createdAt >= ? AND t.createdAt < ?
            ORDER BY t.createdAt DESC
            LIMIT ? OFFSET ?
          `,
          params: [start, end, pageSize, refundsOffset]
        },
        {
          sql: `
            SELECT r.id AS refund_id, r.order_id, r.user_id, u.username, u.email,
                   o.total AS amount, r.status, r.created_at AS createdAt
            FROM refund_requests r
            JOIN orders o ON o.id = r.order_id
            JOIN users u ON u.id = r.user_id
            WHERE r.status = 'APPROVED'
              AND r.created_at >= ? AND r.created_at < ?
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
          `,
          params: [start, end, pageSize, refundsOffset]
        }
      ]).then(r => r.rows);

      res.render('adminDailyReport', {
        user: req.session.user,
        date,
        stats: {
          grossSales,
          refundedAmount,
          netSales,
          orders: orderCount,
          aov
        },
        orders: {
          rows: ordersRows,
          page: ordersPage,
          totalPages: ordersTotalPages,
          total: ordersTotal
        },
        refunds: {
          rows: refundsRows,
          page: refundsPage,
          totalPages: refundsTotalPages,
          total: refundsTotal
        }
      });
    } catch (err) {
      console.error('Error loading daily report:', err);
      res.status(500).send('Database error');
    }
  },

  async dailyReportCsv(req, res) {
    try {
      const date = String(req.query.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).send('Invalid date');
      }

      const { start, end } = toDateRange(date);
      const pageSize = 10000;

      const ordersRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT o.id, o.userId, o.total, o.createdAt, o.status, u.username, u.email
            FROM orders o
            LEFT JOIN users u ON u.id = o.userId
            WHERE o.status IN ('paid','completed','COMPLETED')
              AND o.createdAt >= ? AND o.createdAt < ?
            ORDER BY o.createdAt DESC
            LIMIT ? OFFSET 0
          `,
          params: [start, end, pageSize]
        },
        {
          sql: `
            SELECT o.id, o.user_id AS userId, o.total, o.created_at AS createdAt, o.status, u.username, u.email
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            WHERE o.status IN ('paid','completed','COMPLETED')
              AND o.created_at >= ? AND o.created_at < ?
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET 0
          `,
          params: [start, end, pageSize]
        }
      ]).then(r => r.rows);

      const refundsRows = await runQueryWithFallbacks([
        {
          sql: `
            SELECT t.id AS refund_id, t.orderId AS order_id, o.userId AS user_id, u.username, u.email,
                   t.amount, t.paymentStatus AS status, t.createdAt AS createdAt
            FROM transactions t
            JOIN orders o ON o.id = t.orderId
            JOIN users u ON u.id = o.userId
            WHERE t.paymentStatus = 'COMPLETED' AND t.paymentMethod = 'REFUND'
              AND t.createdAt >= ? AND t.createdAt < ?
            ORDER BY t.createdAt DESC
            LIMIT ? OFFSET 0
          `,
          params: [start, end, pageSize]
        },
        {
          sql: `
            SELECT r.id AS refund_id, r.order_id, r.user_id, u.username, u.email,
                   o.total AS amount, r.status, r.created_at AS createdAt
            FROM refund_requests r
            JOIN orders o ON o.id = r.order_id
            JOIN users u ON u.id = r.user_id
            WHERE r.status = 'APPROVED'
              AND r.created_at >= ? AND r.created_at < ?
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET 0
          `,
          params: [start, end, pageSize]
        }
      ]).then(r => r.rows);

      const escapeCsv = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (/[",\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const lines = [];
      lines.push('section,id,order_id,user_id,username,email,amount,status,created_at');
      (ordersRows || []).forEach(o => {
        lines.push([
          'order',
          o.id,
          '',
          o.userId,
          escapeCsv(o.username || ''),
          escapeCsv(o.email || ''),
          o.total,
          o.status || '',
          o.createdAt ? new Date(o.createdAt).toISOString() : ''
        ].join(','));
      });
      (refundsRows || []).forEach(r => {
        lines.push([
          'refund',
          r.refund_id,
          r.order_id,
          r.user_id,
          escapeCsv(r.username || ''),
          escapeCsv(r.email || ''),
          r.amount,
          r.status || '',
          r.createdAt ? new Date(r.createdAt).toISOString() : ''
        ].join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="daily-report.csv"');
      return res.send(lines.join('\n'));
    } catch (err) {
      console.error('Error exporting daily report CSV:', err);
      return res.status(500).send('Database error');
    }
  }
};

module.exports = AdminController;
