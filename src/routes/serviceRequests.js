const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/serviceRequestController');

router.get('/nearby', authenticate, ctrl.getNearbyRequests);
router.get('/my', authenticate, ctrl.getMyRequests);
router.get('/assigned', authenticate, ctrl.getMyAssignedRequests);
router.get('/available', authenticate, ctrl.getAvailableRequests);
router.get('/technician-history', authenticate, ctrl.getTechnicianHistory);
router.post('/', authenticate, ctrl.createServiceRequest);
router.get('/:id', authenticate, ctrl.getRequestById);
router.put('/:id/status', authenticate, ctrl.updateRequestStatus);
router.put('/:id/cancel', authenticate, ctrl.cancelRequest);
router.delete('/:id', authenticate, ctrl.deleteRequest);
router.post('/:id/interested', authenticate, ctrl.markTechnicianInterested);

module.exports = router;
