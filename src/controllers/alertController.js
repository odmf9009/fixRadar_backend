const Alert = require('../entities/Alert');

async function getMyAlerts(req, res, next) {
  try {
    const alerts = await Alert.find({ userId: req.uid })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(alerts);
  } catch (err) {
    next(err);
  }
}

async function markAlertRead(req, res, next) {
  try {
    await Alert.findOneAndUpdate(
      { _id: req.params.id, userId: req.uid },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function markAllAlertsRead(req, res, next) {
  try {
    await Alert.updateMany({ userId: req.uid, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getUnreadCount(req, res, next) {
  try {
    const count = await Alert.countDocuments({ userId: req.uid, isRead: false });
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyAlerts, markAlertRead, markAllAlertsRead, getUnreadCount };
