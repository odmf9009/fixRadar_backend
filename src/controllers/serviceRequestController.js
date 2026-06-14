const ServiceRequest = require('../entities/ServiceRequest');
const User = require('../entities/User');
const Quote = require('../entities/Quote');
const Alert = require('../entities/Alert');
const Activity = require('../entities/Activity');
const { notifyUser, notifyRequest, broadcastEvent } = require('../socket/socketManager');

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
      minBudget: minBudget || null,
      maxBudget: maxBudget || null,
      targetTechnicianId: targetTechnicianId || null,
    });

    await User.findByIdAndUpdate(req.uid, { $inc: { postsCount: 1 } });

    await Activity.create({
      userId: req.uid,
      type: 'request_created',
      title: 'Solicitud creada',
      description: `Publicaste "${title}"`,
      relatedId: request._id.toString(),
      xpEarned: 50,
    });

    // Notify targeted technician directly
    if (targetTechnicianId) {
      const alert = await Alert.create({
        userId: targetTechnicianId,
        requestId: request._id.toString(),
        requestTitle: title,
        requestImageUrl: imageUrls?.[0] || '',
        address,
        distance: 0,
        type: 'directQuote',
      });
      notifyUser(targetTechnicianId, 'alert:new', alert.toObject());
    }

    // Broadcast globally so all technicians can see the new request
    broadcastEvent('request:created', request.toObject());

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
}

async function getNearbyRequests(req, res, next) {
  try {
    const { latitude, longitude, radius = 30, category, urgency } = req.query;
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }

    const filter = {
      status: 'open',
      targetTechnicianId: null,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
          $maxDistance: parseFloat(radius) * 1000,
        },
      },
    };

    if (category) filter.category = category;
    if (urgency) filter.urgency = urgency;

    const requests = await ServiceRequest.find(filter).limit(100).lean();
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

async function getRequestById(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json(request);
  } catch (err) {
    next(err);
  }
}

async function updateRequestStatus(req, res, next) {
  try {
    const { status } = req.body;
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const isClient = request.clientId === req.uid;
    const isTechnician = request.technicianId === req.uid;

    if (!isClient && !isTechnician) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    request.status = status;
    if (status === 'inProgress') request.assignedAt = new Date();
    if (status === 'completed') request.completedAt = new Date();
    await request.save();

    notifyRequest(request._id.toString(), 'request:status', {
      requestId: request._id.toString(),
      status,
    });

    if (isClient && request.technicianId) {
      notifyUser(request.technicianId, 'request:status', {
        requestId: request._id.toString(),
        status,
      });
    }
    if (isTechnician) {
      notifyUser(request.clientId, 'request:status', {
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

    await Quote.deleteMany({ requestId: request._id });
    await request.deleteOne();

    res.json({ success: true });
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

    // Notify assigned technician if any
    if (request.technicianId) {
      const alert = await Alert.create({
        userId: request.technicianId,
        requestId: request._id.toString(),
        requestTitle: `Pedido cancelado: ${request.title}`,
        requestImageUrl: request.imageUrls?.[0] || '',
        address: request.address,
        distance: 0,
        type: 'system',
      });
      notifyUser(request.technicianId, 'alert:new', alert.toObject());
    }

    await Quote.updateMany(
      { requestId: request._id, status: 'pending' },
      { status: 'cancelled' }
    );

    notifyRequest(request._id.toString(), 'request:cancelled', { requestId: request._id.toString() });

    res.json({ success: true });
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
      request.responsesCount += 1;
      await request.save();
    }

    notifyUser(request.clientId, 'request:technician_interested', {
      requestId: request._id.toString(),
      technicianId: req.uid,
      responsesCount: request.responsesCount,
    });

    res.json({ success: true, responsesCount: request.responsesCount });
  } catch (err) {
    next(err);
  }
}

async function hideRequest(req, res, next) {
  try {
    // Stores hidden requests in user's subdocument (just mark in alert/activity)
    // For simplicity we track it client-side with shared_preferences
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createServiceRequest,
  getNearbyRequests,
  getMyRequests,
  getMyAssignedRequests,
  getRequestById,
  updateRequestStatus,
  deleteRequest,
  cancelRequest,
  markTechnicianInterested,
  hideRequest,
};
