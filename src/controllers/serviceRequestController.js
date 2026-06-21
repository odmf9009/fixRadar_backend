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

    // Broadcast via socket to all connected clients (real-time update)
    broadcastEvent('request:created', {
      request: request.toObject(),
      location: { latitude, longitude },
    });

    // Notificar a técnicos: crea Alert (campana, online y offline) + FCM (se
    // auto-omite si el técnico tiene la app en primer plano).
    setImmediate(async () => {
      try {
        // Caso 1: solicitud DIRIGIDA a un técnico concreto (cotización directa).
        // Notificar SOLO a ese técnico, sin difundir a toda la zona.
        if (targetTechnicianId) {
          const directAlert = await Alert.create({
            userId: targetTechnicianId.toString(),
            requestId: request._id.toString(),
            requestTitle: `${user.name || user.username} te solicitó una cotización: ${title}`,
            requestImageUrl: (imageUrls && imageUrls[0]) || '',
            address: address || '',
            distance: 0,
            type: 'directQuote',
          });
          notifyUser(targetTechnicianId.toString(), 'alert:new', directAlert.toObject());
          sendPushNotification(targetTechnicianId.toString(), {
            title: 'Solicitud de cotización',
            body: `${user.name || user.username} te solicitó una cotización: ${title}`,
            data: { type: 'directQuote', requestId: request._id.toString() },
          });
          return;
        }

        // Caso 2: difusión por zona — técnicos cuya especialidad coincide
        // (o 'Handyman') y que tienen la avería dentro de su radio de servicio.
        const candidates = await User.find({
          role: 'technician',
          _id: { $ne: req.uid },
          notificationsEnabled: true,
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [longitude, latitude] },
              $maxDistance: 300000, // 300km broad search
            },
          },
          // Specialty must match OR technician has 'Handyman' (all-categories)
          $or: [
            { specialties: category },
            { specialties: 'Handyman' },
          ],
        }).select('_id location serviceRadius');

        for (const tech of candidates) {
          // Check technician's own service radius (stored in miles → convert to meters)
          const [techLng, techLat] = tech.location.coordinates;
          const R = 6371000; // Earth radius in meters
          const dLat = ((latitude - techLat) * Math.PI) / 180;
          const dLng = ((longitude - techLng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((techLat * Math.PI) / 180) *
              Math.cos((latitude * Math.PI) / 180) *
              Math.sin(dLng / 2) ** 2;
          const distanceMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const techRadiusMeters = (tech.serviceRadius || 20) * 1609.34; // miles → meters

          if (distanceMeters <= techRadiusMeters) {
            // Alerta in-app (campana) para todos los que coinciden.
            const nearbyAlert = await Alert.create({
              userId: tech._id.toString(),
              requestId: request._id.toString(),
              requestTitle: title,
              requestImageUrl: (imageUrls && imageUrls[0]) || '',
              address: address || '',
              distance: distanceMeters,
              type: 'nearby',
            });
            notifyUser(tech._id.toString(), 'alert:new', nearbyAlert.toObject());
            // FCM (se auto-omite si está en primer plano o no tiene token).
            sendPushNotification(tech._id.toString(), {
              title: '¡Nueva avería en tu zona!',
              body: `${title} — ${address || category}`,
              data: {
                type: 'new_request',
                requestId: request._id.toString(),
              },
            });
          }
        }
      } catch (err) {
        console.error('[Push] Error notifying nearby technicians:', err.message);
      }
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
        const completedAlert = await Alert.create({
          userId: request.technicianId,
          requestId: request._id.toString(),
          requestTitle: `¡Pago/Trabajo confirmado! ${request.title}`,
          requestImageUrl: request.imageUrls?.[0] || '',
          address: request.address,
          distance: 0,
          type: 'system',
        });
        notifyUser(request.technicianId, 'alert:new', completedAlert.toObject());
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

    const requestId = req.params.id;

    // Cascada: eliminar todo lo que cuelga del pedido para no dejar huérfanos
    // (quotes/alerts que apunten a un pedido inexistente rompen "ver pedido"/"rechazar").
    const quotes = await Quote.find({ requestId }).lean();
    await Quote.deleteMany({ requestId });
    await Alert.deleteMany({ requestId });

    await ServiceRequest.findByIdAndDelete(requestId);

    // Notify the initiator so their local streams refresh
    notifyUser(req.uid, 'request:deleted', { requestId });

    // Avisar a cada técnico que había cotizado para que su lista de clientes se refresque
    for (const q of quotes) {
      notifyUser(q.technicianId, 'request:deleted', { requestId });
    }

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
    notifyUser(request.clientId, 'alert:new', alert.toObject());

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

      const cancelAlert = await Alert.create({
        userId: previousTechnicianId,
        requestId: request._id.toString(),
        requestTitle: `Asignación cancelada: ${request.title}`,
        requestImageUrl: request.imageUrls?.[0] || '',
        address: request.address,
        distance: 0,
        type: 'system',
      });
      notifyUser(previousTechnicianId, 'alert:new', cancelAlert.toObject());
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
