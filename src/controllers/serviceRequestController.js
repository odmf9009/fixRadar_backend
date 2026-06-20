const ServiceRequest = require('../entities/ServiceRequest');
const User = require('../entities/User');
const Quote = require('../entities/Quote');
const Alert = require('../entities/Alert');
const Activity = require('../entities/Activity');
const mongoose = require('mongoose');
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
    const uid = req.uid;
    const mongoose = require('mongoose');

    // 1. Get all request IDs from quotes sent by this technician
    const myQuotes = await Quote.find({ technicianId: uid }).select('requestId').lean();
    const requestIdsFromQuotes = myQuotes.map(q => q.requestId.toString());

    // 2. Find all requests where the technician is either assigned OR has sent a quote
    // We search technicianId as both String and potentially ObjectId if it was incorrectly cast
    const uidObj = mongoose.isValidObjectId(uid) ? new mongoose.Types.ObjectId(uid) : null;

    const orQuery = [
      { technicianId: uid },
      { interestedTechnicians: uid },
      { _id: { $in: requestIdsFromQuotes } }
    ];

    if (uidObj) {
      orQuery.push({ technicianId: uidObj });
      orQuery.push({ interestedTechnicians: uidObj });
    }

    const requests = await ServiceRequest.find({ $or: orQuery })
      .sort({ updatedAt: -1 })
      .lean();

    const formatted = requests.map(r => ({
      ...r,
      id: r._id.toString(),
      clientId: r.clientId ? r.clientId.toString() : '',
      technicianId: r.technicianId ? r.technicianId.toString() : null,
      acceptedQuoteId: r.acceptedQuoteId ? r.acceptedQuoteId.toString() : null
    }));

    res.json(formatted);
  } catch (err) {
    console.error('[History] Error:', err);
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

    if (status === 'completed') {
      request.completedAt = new Date();
      if (request.acceptedQuoteId) {
        await Quote.findByIdAndUpdate(request.acceptedQuoteId, {
          status: 'completed',
          statusUpdatedAt: new Date()
        });
      }
    }

    await request.save();

    // Notify the other party
    const targetId = request.clientId === req.uid ? request.technicianId : request.clientId;
    if (targetId) {
      notifyUser(targetId, 'request:status', {
        requestId: request._id.toString(),
        status,
      });

      if (status === 'completed' && request.clientId === req.uid) {
        // Create an alert for the technician that the job was confirmed
        await Alert.create({
          userId: request.technicianId,
          requestId: request._id.toString(),
          requestTitle: `¡Pago/Trabajo confirmado! ${request.title}`,
          requestImageUrl: request.imageUrls?.[0] || '',
          address: request.address,
          distance: 0,
          type: 'system',
        });
      }
    }

    // Also notify the initiator so their local streams refresh
    notifyUser(req.uid, 'request:status', {
      requestId: request._id.toString(),
      status,
    });

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

    // Notify the initiator so their local streams refresh
    notifyUser(req.uid, 'request:deleted', {
      requestId: req.params.id,
    });

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

    // Also notify the client themselves so their UI refreshes
    notifyUser(req.uid, 'request:status', {
      requestId: request._id.toString(),
      status: 'cancelled',
    });

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
    const { completionPhotoUrl } = req.body;
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (request.technicianId !== req.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Move to 'finishedByTechnician' so client can confirm
    request.status = 'finishedByTechnician';
    if (completionPhotoUrl) {
      request.completionPhotoUrl = completionPhotoUrl;
    }
    await request.save();

    const alert = await Alert.create({
      userId: request.clientId,
      requestId: request._id.toString(),
      requestTitle: `¡Trabajo terminado! ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'system',
    });

    // Notify Client
    notifyUser(request.clientId, 'request:status', {
      requestId: request._id.toString(),
      status: 'finishedByTechnician',
      alert: alert.toObject()
    });

    // Notify Technician (Initiator) to update their UI
    notifyUser(req.uid, 'request:status', {
      requestId: request._id.toString(),
      status: 'finishedByTechnician',
    });

    sendPushNotification(request.clientId, {
      title: 'Trabajo terminado',
      body: `El técnico ha terminado tu trabajo "${request.title}". Por favor, confírmalo en la app.`,
      data: {
        type: 'request_finished',
        requestId: request._id.toString(),
      },
    });

    res.json({ message: 'Work marked as finished, awaiting client confirmation', status: 'finishedByTechnician' });
  } catch (err) {
    next(err);
  }
}

async function cancelAssignment(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.clientId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

    const previousTechnicianId = request.technicianId;
    const previousQuoteId = request.acceptedQuoteId;

    // Reset request fields
    request.status = 'open';
    request.technicianId = null;
    request.technicianName = null;
    request.technicianPhotoUrl = null;
    request.acceptedQuoteId = null;
    request.assignedAt = null;
    request.budget = null;
    await request.save();

    // Reset quote status so it can be accepted again or reconsidered
    if (previousQuoteId) {
      await Quote.findByIdAndUpdate(previousQuoteId, {
        status: 'pending',
        statusUpdatedAt: new Date()
      });
    }

    // Notify technician that assignment was cancelled
    if (previousTechnicianId) {
      notifyUser(previousTechnicianId, 'request:status', {
        requestId: request._id.toString(),
        status: 'open',
      });

      await Alert.create({
        userId: previousTechnicianId,
        requestId: request._id.toString(),
        requestTitle: `Asignación cancelada: ${request.title}`,
        requestImageUrl: request.imageUrls?.[0] || '',
        address: request.address,
        distance: 0,
        type: 'system',
      });
    }

    // Notify the client themselves so their UI refreshes
    notifyUser(req.uid, 'request:status', {
      requestId: request._id.toString(),
      status: 'open',
    });

    notifyRequest(request._id.toString(), 'request:assigned', request.toObject());

    res.json(request);
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
  cancelAssignment,
};
