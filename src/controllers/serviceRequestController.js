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

    // Notify nearby technicians via Alerts (Radar)
    try {
      // Push goes to background users too — only skip if manually disabled
      const nearbyTechs = await User.find({
        $or: [{ role: 'technician' }, { userType: 'technician' }],
        notificationsEnabled: { $ne: false },
        specialties: { $in: [category, 'Handyman'] },
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
            $maxDistance: 80000, // ~50 miles — individual radius checked below
          },
        },
      }).select('_id fcmToken notificationsEnabled serviceRadius workHours weekendAvailability location').limit(30);

      // Returns true if current server time is within technician's work hours
      const isWithinWorkHours = (workHours, weekendAvailability) => {
        if (!workHours) return true;
        const now = new Date();
        const day = now.getDay(); // 0=Sun, 6=Sat
        if ((day === 0 || day === 6) && !weekendAvailability) return false;
        const parts = workHours.split(' - ');
        if (parts.length !== 2) return true;
        const parseTime = (s) => {
          const m = s.trim().match(/^(\d+):(\d+)\s*(AM|PM)$/i);
          if (!m) return null;
          let h = parseInt(m[1]); const min = parseInt(m[2]); const p = m[3].toUpperCase();
          if (p === 'PM' && h !== 12) h += 12;
          if (p === 'AM' && h === 12) h = 0;
          return h * 60 + min;
        };
        const start = parseTime(parts[0]); const end = parseTime(parts[1]);
        if (start === null || end === null) return true;
        const nowMin = now.getHours() * 60 + now.getMinutes();
        return nowMin >= start && nowMin <= end;
      };

      // Haversine helper (meters)
      const haversine = (lat1, lon1, lat2, lon2) => {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      console.log(`[NearbyAlert] Found ${nearbyTechs.length} candidate techs for request in [${latitude}, ${longitude}]`);

      for (const tech of nearbyTechs) {
        if (tech._id.toString() === req.uid) continue;

        // Skip technicians outside their configured work hours (only if explicitly set)
        if (tech.workHours && tech.workHours !== '9:00 AM - 6:00 PM') {
          if (!isWithinWorkHours(tech.workHours, tech.weekendAvailability)) {
            console.log(`[NearbyAlert] Skip ${tech._id}: outside work hours (${tech.workHours})`);
            continue;
          }
        }

        // Respect each technician's individual service radius (stored in miles)
        if (tech.location?.coordinates) {
          const [tLon, tLat] = tech.location.coordinates;
          const distMeters = haversine(parseFloat(latitude), parseFloat(longitude), tLat, tLon);
          const techRadiusMeters = (tech.serviceRadius || 20) * 1609.34;
          if (distMeters > techRadiusMeters) {
            console.log(`[NearbyAlert] Skip ${tech._id}: distance ${Math.round(distMeters/1000)}km > radius ${tech.serviceRadius || 20} miles`);
            continue;
          }
        }

        const alert = await Alert.create({
          userId: tech._id,
          requestId: request._id.toString(),
          requestTitle: `¡Nueva incidencia cerca! ${title}`,
          requestImageUrl: imageUrls?.[0] || '',
          address,
          distance: 0,
          type: 'nearby',
        });
        notifyUser(tech._id, 'alert:new', alert.toObject());

        sendPushNotification(tech._id, {
          title: '¡Nueva incidencia en tu área!',
          body: `Se ha publicado un problema de ${category} cerca de tu zona.`,
          data: {
            type: 'nearby_request',
            requestId: request._id.toString(),
          },
        });
      }
    } catch (e) {
      console.error('[NearbyAlert] Error:', e);
    }

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
    const requests = await ServiceRequest.find({
      clientId: req.uid,
      status: { $nin: ['cancelled', 'completed'] }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Add a check to ensure we are returning the _id as id for the frontend if needed
    const formattedRequests = requests.map(r => ({
      ...r,
      id: r._id.toString()
    }));

    res.json(formattedRequests);
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
    broadcastEvent('request:status', { requestId: request._id.toString(), status });

    if (isClient && request.technicianId) {
      notifyUser(request.technicianId, 'request:status', {
        requestId: request._id.toString(),
        status,
      });

      // Alert for technician if client cancels or something
      if (status === 'cancelled') {
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
    }

    if (isTechnician) {
      notifyUser(request.clientId, 'request:status', {
        requestId: request._id.toString(),
        status,
      });

      // Alert for client if technician finishes or arrives
      let alertTitle = '';
      if (status === 'finishedByTechnician') alertTitle = 'El técnico terminó el trabajo';
      if (status === 'inProgress') alertTitle = 'El técnico ha llegado al lugar';

      if (alertTitle) {
        const alert = await Alert.create({
          userId: request.clientId,
          requestId: request._id.toString(),
          requestTitle: `${alertTitle}: ${request.title}`,
          requestImageUrl: request.imageUrls?.[0] || '',
          address: request.address,
          distance: 0,
          type: 'system',
        });
        notifyUser(request.clientId, 'alert:new', alert.toObject());

        sendPushNotification(request.clientId, {
          title: alertTitle,
          body: `El técnico ha actualizado el estado de tu pedido: ${request.title}`,
          data: { type: 'status_update', requestId: request._id.toString() },
        });
      }
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
    const requestIdStr = request._id.toString();
    await request.deleteOne();

    broadcastEvent('request:deleted', { requestId: requestIdStr });

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

    // Use updateOne to ensure the status is changed in the DB directly
    await ServiceRequest.updateOne({ _id: request._id }, { status: 'cancelled' });

    // Notify ALL technicians who sent proposals for this request
    const quotes = await Quote.find({ requestId: request._id });

    for (const quote of quotes) {
      const techId = quote.technicianId;

      // Create alert for the technician
      const alert = await Alert.create({
        userId: techId,
        requestId: request._id.toString(),
        requestTitle: `Pedido cancelado: ${request.title}`,
        requestImageUrl: request.imageUrls?.[0] || '',
        address: request.address,
        distance: 0,
        type: 'system',
      });

      // Notify via Socket
      notifyUser(techId, 'alert:new', alert.toObject());

      // Send Push Notification
      sendPushNotification(techId, {
        title: 'Pedido cancelado',
        body: `❌ El pedido "${request.title}" ha sido cancelado por el cliente.`,
        data: {
          type: 'request_cancelled',
          requestId: request._id.toString(),
        },
      });
    }

    await Quote.updateMany(
      { requestId: request._id, status: 'pending' },
      { status: 'cancelled' }
    );

    // Notify the client specifically to trigger UI refresh
    notifyUser(req.uid, 'request:cancelled', { requestId: request._id.toString() });

    // Broadcast status change
    notifyRequest(request._id.toString(), 'request:cancelled', { requestId: request._id.toString() });
    broadcastEvent('request:status', { requestId: request._id.toString(), status: 'cancelled' });
    broadcastEvent('request:cancelled', { requestId: request._id.toString() });

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
    // Tracks hidden requests client-side with shared_preferences
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// Open requests available for technicians to quote on
async function getAvailableRequests(req, res, next) {
  try {
    const requests = await ServiceRequest.find({
      status: { $in: ['open', 'pending'] },
    }).sort({ createdAt: -1 }).lean();
    res.json(requests);
  } catch (err) {
    next(err);
  }
}

// Completed/closed jobs where the logged-in technician was assigned
async function getTechnicianHistory(req, res, next) {
  try {
    const requests = await ServiceRequest.find({
      technicianId: req.uid,
      status: { $in: ['completed', 'closed', 'cancelled'] },
    }).sort({ updatedAt: -1 }).lean();
    res.json(requests);
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
};
