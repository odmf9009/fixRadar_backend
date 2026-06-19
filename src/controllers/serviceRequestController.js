const ServiceRequest = require('../entities/ServiceRequest');
const User = require('../entities/User');
const Quote = require('../entities/Quote');
const Alert = require('../entities/Alert');
const Activity = require('../entities/Activity');
const { notifyUser, notifyRequest, broadcastEvent } = require('../socket/socketManager');
const { sendPushNotification } = require('../utils/notifications');

async function createServiceRequest(req, res, next) {
  try {
    const {
      title, description, category, imageUrls, thumbnailUrls,
      latitude, longitude, address, urgency, minBudget, maxBudget, targetTechnicianId,
    } = req.body;

    const user = await User.findById(req.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const request = await ServiceRequest.create({
      title,
      description,
      category,
      imageUrls: imageUrls || [],
      thumbnailUrls: thumbnailUrls || [],
      location: { type: 'Point', coordinates: [longitude, latitude] },
      address,
      urgency: urgency || 'medium',
      clientId: req.uid,
      clientName: user.username || user.name,
      clientPhotoUrl: user.profileImageUrl || null,
      minBudget,
      maxBudget,
      targetTechnicianId,
    });

    // Broadcast to nearby technicians
    broadcastEvent('request:created', {
      request: request.toObject(),
      location: { latitude, longitude },
    });

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
}

async function getNearbyRequests(req, res, next) {
  try {
    const { latitude, longitude, radius = 50000, category } = req.query;
    const query = {
      status: 'open',
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
          $maxDistance: parseInt(radius),
        },
      },
    };

    if (category && category !== 'Todas') {
      query.category = category;
    }

    const requests = await ServiceRequest.find(query).limit(50).lean();
    res.json(requests);
  } catch (err) {
    next(err);
  }
}

async function getMyRequests(req, res, next) {
  try {
    const requests = await ServiceRequest.find({ clientId: req.uid })
      .sort({ createdAt: -1 })
      .lean();
    res.json(requests);
  } catch (err) {
    next(err);
  }
}

async function getMyAssignedRequests(req, res, next) {
  try {
    const requests = await ServiceRequest.find({
      technicianId: req.uid,
      status: { $in: ['assigned', 'inProgress', 'finishedByTechnician'] },
    }).sort({ updatedAt: -1 }).lean();
    res.json(requests);
  } catch (err) {
    next(err);
  }
}

async function getAvailableRequests(req, res, next) {
  try {
    const requests = await ServiceRequest.find({
      status: 'open',
      $or: [
        { targetTechnicianId: null },
        { targetTechnicianId: req.uid }
      ]
    }).sort({ createdAt: -1 }).limit(100).lean();
    res.json(requests);
  } catch (err) {
    next(err);
  }
}

async function getTechnicianHistory(req, res, next) {
  try {
    const myQuotes = await Quote.find({ technicianId: req.uid }).select('requestId').lean();
    const requestIdsFromQuotes = myQuotes.map(q => q.requestId.toString());

    const requests = await ServiceRequest.find({
      $or: [
        { technicianId: req.uid },
        { _id: { $in: requestIdsFromQuotes } }
      ]
    }).sort({ updatedAt: -1 }).lean();

    const formatted = requests.map(r => ({
      ...r,
      id: r._id.toString(),
      clientId: r.clientId ? r.clientId.toString() : '',
      technicianId: r.technicianId ? r.technicianId.toString() : null,
      acceptedQuoteId: r.acceptedQuoteId ? r.acceptedQuoteId.toString() : null
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
}

async function getRequestById(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json({ ...request, id: request._id.toString() });
  } catch (err) {
    next(err);
  }
}

async function updateRequestStatus(req, res, next) {
  try {
    const { status } = req.body;
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (request.clientId !== req.uid && request.technicianId !== req.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    request.status = status;
    await request.save();

    const targetId = request.clientId === req.uid ? request.technicianId : request.clientId;
    if (targetId) {
      notifyUser(targetId, 'request:status', {
        requestId: request._id.toString(),
        status,
      });
    }

    res.json(request);
  } catch (err) {
    next(err);
  }
}

async function deleteRequest(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.clientId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

    await ServiceRequest.findByIdAndDelete(req.params.id);
    res.json({ message: 'Request deleted' });
  } catch (err) {
    next(err);
  }
}

async function cancelRequest(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.clientId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

    request.status = 'cancelled';
    await request.save();

    if (request.technicianId) {
      notifyUser(request.technicianId, 'request:status', {
        requestId: request._id.toString(),
        status: 'cancelled',
      });
    }

    res.json(request);
  } catch (err) {
    next(err);
  }
}

async function markTechnicianInterested(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (!request.interestedTechnicians.includes(req.uid)) {
      request.interestedTechnicians.push(req.uid);
      request.responsesCount = request.interestedTechnicians.length;
      await request.save();
    }

    res.json(request);
  } catch (err) {
    next(err);
  }
}

async function hideRequest(req, res, next) {
  try {
    res.json({ message: 'Request hidden locally' });
  } catch (err) {
    next(err);
  }
}

async function finishWorkByTechnician(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (request.technicianId !== req.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    request.status = 'completed';
    request.completedAt = new Date();
    await request.save();

    if (request.acceptedQuoteId) {
      await Quote.findByIdAndUpdate(request.acceptedQuoteId, {
        status: 'completed',
        statusUpdatedAt: new Date()
      });
    }

    const alert = await Alert.create({
      userId: request.clientId,
      requestId: request._id.toString(),
      requestTitle: `¡Trabajo finalizado! ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'system',
    });

    notifyUser(request.clientId, 'request:status', {
      requestId: request._id.toString(),
      status: 'completed',
      alert: alert.toObject()
    });

    sendPushNotification(request.clientId, {
      title: 'Trabajo finalizado',
      body: `El técnico ha marcado tu trabajo "${request.title}" como finalizado.`,
      data: {
        type: 'request_finished',
        requestId: request._id.toString(),
      },
    });

    res.json({ message: 'Work finished successfully', status: 'completed' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createServiceRequest,
  getNearbyRequests,
  getMyRequests,
  getMyAssignedRequests,
  getAvailableRequests,
  getTechnicianHistory,
  getRequestById,
  updateRequestStatus,
  deleteRequest,
  cancelRequest,
  markTechnicianInterested,
  hideRequest,
  finishWorkByTechnician,
};
