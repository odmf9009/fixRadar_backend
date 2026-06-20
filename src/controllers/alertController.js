const Alert = require('../entities/Alert');
const { notifyUser } = require('../socket/socketManager');

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
    notifyUser(req.uid, 'alerts:refresh', {});
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function markAllAlertsRead(req, res, next) {
  try {
    await Alert.updateMany({ userId: req.uid, isRead: false }, { isRead: true });
    notifyUser(req.uid, 'alerts:refresh', {});
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// Marca como leída la alerta (campana) de una conversación de chat.
// Una conversación se identifica por requestId + quoteId (quoteId opcional).
async function markConversationRead(req, res, next) {
  try {
    const { requestId, quoteId } = req.body;
    const filter = {
      userId: req.uid,
      type: 'message',
      isRead: false,
    };
    if (quoteId) {
      filter.quoteId = quoteId;
    } else if (requestId) {
      filter.requestId = requestId;
      filter.quoteId = null;
    } else {
      return res.json({ success: true });
    }
    await Alert.updateMany(filter, { isRead: true });
    notifyUser(req.uid, 'alerts:refresh', {});
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

async function clearAllAlerts(req, res, next) {
  try {
    const result = await Alert.deleteMany({ userId: req.uid });
    console.log(`[Alerts] Cleared ${result.deletedCount} alerts for user ${req.uid}`);

    notifyUser(req.uid, 'alerts:cleared', {});
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyAlerts, markAlertRead, markAllAlertsRead, markConversationRead, getUnreadCount, clearAllAlerts };
