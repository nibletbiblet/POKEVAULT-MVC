const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/admin/users', requireAuth, requireRole('admin'), AdminController.listUsers);
router.get('/admin/users/:id/suspension-history', requireAuth, requireRole('admin'), AdminController.suspensionHistory);
router.get('/admin/users/:id/orders', requireAuth, requireRole('admin'), AdminController.userOrders);
router.get('/admin/users/add', requireAuth, requireRole('admin'), AdminController.addUserForm);
router.post('/admin/users/add', requireAuth, requireRole('admin'), AdminController.addUser);
router.get('/admin/users/:id/edit', requireAuth, requireRole('admin'), AdminController.editUserForm);
router.post('/admin/users/:id/edit', requireAuth, requireRole('admin'), AdminController.editUser);
router.post('/admin/users/:id/ban', requireAuth, requireRole('admin'), AdminController.banUser);
router.post('/admin/users/:id/unban', requireAuth, requireRole('admin'), AdminController.unbanUser);
router.post('/admin/users/:id/delete', requireAuth, requireRole('admin'), AdminController.deleteUser);
router.get('/admin/users/:id/delete', requireAuth, requireRole('admin'), AdminController.deleteUser);
router.get('/admin/audit-log', requireAuth, requireRole('admin'), AdminController.auditLog);
router.get('/admin/trades', requireAuth, requireRole('admin'), AdminController.trades);
router.get('/admin/dashboard', requireAuth, requireRole('admin'), AdminController.dashboard);
router.get('/admin/reports/day', requireAuth, requireRole('admin'), AdminController.dailyReport);
router.get('/admin/orders-status', requireAuth, requireRole('admin'), AdminController.orderStatus);
router.get('/admin/refunds', requireAuth, requireRole('admin'), AdminController.refundRequestsPage);
router.post('/admin/orders/:id/send', requireAuth, requireRole('admin'), AdminController.adminSendOrder);

module.exports = router;
