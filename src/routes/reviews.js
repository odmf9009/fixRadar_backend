const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/reviewController');

router.post('/', authenticate, ctrl.createReview);
router.get('/technician/:technicianId', authenticate, ctrl.getTechnicianReviews);

module.exports = router;
