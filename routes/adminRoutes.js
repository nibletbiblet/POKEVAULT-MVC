const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole } = require('../middleware/auth');
const requireAdminKey = require('../middlewares/requireAdminKey');

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
router.post('/admin/users/:id/delete', requireAuth, requireRole('admin'), requireAdminKey, AdminController.deleteUser);
router.get('/admin/users/:id/delete', requireAuth, requireRole('admin'), requireAdminKey, AdminController.deleteUser);
router.get('/admin/audit-log', requireAuth, requireRole('admin'), AdminController.auditLog);
router.get('/admin/activity', requireAuth, requireRole('admin'), AdminController.adminActivity);
router.get('/admin/trades', requireAuth, requireRole('admin'), AdminController.trades);
router.get('/admin/dashboard', requireAuth, requireRole('admin'), AdminController.dashboard);
router.get('/admin/dashboard.csv', requireAuth, requireRole('admin'), requireAdminKey, AdminController.dashboardCsv);
router.get('/admin/dashboard.xlsx', requireAuth, requireRole('admin'), requireAdminKey, AdminController.dashboardXlsx);
router.get('/admin/dashboard.xls', requireAuth, requireRole('admin'), requireAdminKey, AdminController.dashboardExcel);
router.get('/admin/reports/day', requireAuth, requireRole('admin'), AdminController.dailyReport);
router.get('/admin/reports/daily.csv', requireAuth, requireRole('admin'), requireAdminKey, AdminController.dailyReportCsv);
router.get('/admin/orders-status', requireAuth, requireRole('admin'), AdminController.orderStatus);
router.get('/admin/refunds', requireAuth, requireRole('admin'), AdminController.refundRequestsPage);
router.post('/admin/orders/:id/send', requireAuth, requireRole('admin'), AdminController.adminSendOrder);
router.get('/admin/kyc', requireAuth, requireRole('admin'), AdminController.adminKyc);
router.post('/admin/kyc/:userId/approve', requireAuth, requireRole('admin'), AdminController.adminKycApprove);
router.post('/admin/kyc/:userId/reject', requireAuth, requireRole('admin'), AdminController.adminKycReject);

module.exports = router;
