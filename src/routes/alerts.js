const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/alertController');

router.get('/', authenticate, ctrl.getMyAlerts);
router.get('/unread-count', authenticate, ctrl.getUnreadCount);
router.put('/read-all', authenticate, ctrl.markAllAlertsRead);
router.put('/:id/read', authenticate, ctrl.markAlertRead);

module.exports = router;
