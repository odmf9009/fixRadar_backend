const Quote = require('../entities/Quote');
const ServiceRequest = require('../entities/ServiceRequest');
const User = require('../entities/User');
const Alert = require('../entities/Alert');
const Activity = require('../entities/Activity');
const socketManager = require('../socket/socketManager');
const { sendPushNotification } = require('../utils/notifications');

async function sendQuote(req, res, next) {
  try {
    const { requestId, minPrice, maxPrice, message, estimatedTime } = req.body;

    const request = await ServiceRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'open' && request.status !== 'assigned') {
      return res.status(400).json({ error: 'Request is not accepting quotes' });
    }
    if (request.clientId === req.uid) {
      return res.status(403).json({ error: 'You cannot quote your own request' });
    }

    const technician = await User.findById(req.uid);
    if (!technician) return res.status(404).json({ error: 'Technician not found' });

    // One quote per technician per request
    const existing = await Quote.findOne({ requestId, technicianId: req.uid });
    if (existing) return res.status(400).json({ error: 'You already sent a quote for this request' });

    const quote = await Quote.create({
      requestId,
      clientId: request.clientId,
      technicianId: req.uid,
      technicianName: technician.username || technician.name,
      technicianPhotoUrl: technician.profileImageUrl || null,
      technicianRating: technician.rating,
      price: minPrice,
      minPrice,
      maxPrice,
      message,
      estimatedTime: estimatedTime || null,
    });

    await ServiceRequest.findByIdAndUpdate(requestId, {
      $inc: { responsesCount: 1 },
      $addToSet: { interestedTechnicians: req.uid },
    });

    await Activity.create({
      userId: req.uid,
      type: 'quote_sent',
      title: 'Presupuesto enviado',
      description: `Enviaste un presupuesto para "${request.title}"`,
      relatedId: quote._id.toString(),
      xpEarned: 20,
    });

    const alert = await Alert.create({
      userId: request.clientId,
      requestId: requestId,
      requestTitle: `${technician.name || technician.username} te ha enviado una cotización para: ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'quoteReceived',
    });

    socketManager.notifyUser(request.clientId, 'quote:new', {
      quote: quote.toObject(),
      alert: alert.toObject(),
    });
    socketManager.notifyUser(request.clientId, 'alert:new', alert.toObject());
    socketManager.notifyRequest(requestId, 'quote:new', quote.toObject());

    // Send Push Notification
    sendPushNotification(request.clientId, {
      title: '¡Nueva propuesta recibida!',
      body: `${technician.name} ha enviado un presupuesto para: ${request.title}`,
      data: {
        type: 'quote_received',
        requestId: requestId,
        quoteId: quote._id.toString(),
      },
    });

    res.status(201).json(quote);
  } catch (err) {
    next(err);
  }
}

async function getQuotesForRequest(req, res, next) {
  try {
    const request = await ServiceRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const filter = { requestId: req.params.requestId };

    // Security: If not the client, only allow seeing their own quote
    if (request.clientId !== req.uid) {
      filter.technicianId = req.uid;
    } else {
      // If it is the client, only show pending or counter-offers (active quotes)
      filter.status = { $in: ['pending', 'counter_offer_sent'] };
    }

    const quotes = await Quote.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json(quotes);
  } catch (err) {
    next(err);
  }
}

async function getMyQuotes(req, res, next) {
  try {
    const quotes = await Quote.find({ technicianId: req.uid })
      .sort({ createdAt: -1 })
      .lean();
    res.json(quotes);
  } catch (err) {
    next(err);
  }
}

async function getQuotesForClient(req, res, next) {
  try {
    const quotes = await Quote.find({
      clientId: req.uid,
      status: { $in: ['pending', 'counter_offer_sent'] }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Defensivo: descartar cotizaciones huérfanas cuyo pedido ya no existe,
    // para que la pantalla "técnicos que respondieron" nunca muestre tarjetas rotas.
    const reqIds = [...new Set(quotes.map(q => String(q.requestId)).filter(Boolean))];
    const existing = await ServiceRequest.find({ _id: { $in: reqIds } }, { _id: 1 }).lean();
    const existingSet = new Set(existing.map(r => String(r._id)));
    const valid = quotes.filter(q => existingSet.has(String(q.requestId)));

    res.json(valid);
  } catch (err) {
    next(err);
  }
}

async function acceptQuote(req, res, next) {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const request = await ServiceRequest.findById(quote.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.clientId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

    const technician = await User.findById(quote.technicianId);
    if (!technician) return res.status(404).json({ error: 'Technician not found' });

    // Accept this quote
    quote.status = 'accepted';
    quote.statusUpdatedAt = new Date();
    quote.history.push({ action: 'accepted', price: quote.minPrice, message: 'Accepted by client', by: req.uid });
    await quote.save();

    // Reject all others
    await Quote.updateMany(
      { requestId: request._id, _id: { $ne: quote._id }, status: 'pending' },
      { status: 'rejected', statusUpdatedAt: new Date() }
    );

    // Update the service request
    request.status = 'assigned';
    request.technicianId = quote.technicianId;
    request.technicianName = technician.username || technician.name;
    request.technicianPhotoUrl = technician.profileImageUrl || null;
    request.budget = quote.price || quote.minPrice;
    request.acceptedQuoteId = quote._id;
    request.assignedAt = new Date();
    request.isChatEnabled = true;
    await request.save();

    await Activity.create({
      userId: quote.technicianId,
      type: 'quote_accepted',
      title: 'Presupuesto aceptado',
      description: `Tu presupuesto para "${request.title}" fue aceptado`,
      relatedId: request._id.toString(),
      xpEarned: 100,
    });

    const alert = await Alert.create({
      userId: quote.technicianId,
      requestId: request._id.toString(),
      requestTitle: `¡Tu presupuesto fue aceptado! ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'system',
    });

    socketManager.notifyUser(quote.technicianId, 'quote:accepted', {
      quote: quote.toObject(),
      request: request.toObject(),
      alert: alert.toObject(),
    });
    socketManager.notifyUser(quote.technicianId, 'alert:new', alert.toObject());

    // Notify the client initiatior too
    socketManager.notifyUser(req.uid, 'request:status', {
      requestId: request._id.toString(),
      status: 'assigned',
    });

    socketManager.notifyRequest(request._id.toString(), 'request:assigned', request.toObject());

    sendPushNotification(quote.technicianId, {
      title: '¡Tu propuesta fue aceptada!',
      body: `El cliente aceptó tu presupuesto para: ${request.title}`,
      data: {
        type: 'quote_accepted',
        requestId: request._id.toString(),
        quoteId: quote._id.toString(),
      },
    });

    res.json({ quote: quote.toObject(), request: request.toObject() });
  } catch (err) {
    next(err);
  }
}

async function rejectQuote(req, res, next) {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const request = await ServiceRequest.findById(quote.requestId);
    if (!request || request.clientId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

    // If the technician had already sent a counter-offer, a second rejection is
    // definitive — no further counter-offers are allowed.
    const isFinal = quote.status === 'counter_offer_sent';
    const newStatus = isFinal ? 'final_rejected' : 'rejected';

    quote.status = newStatus;
    quote.statusUpdatedAt = new Date();
    quote.history.push({ action: newStatus, by: req.uid, message: req.body.reason || '' });
    await quote.save();

    const alert = await Alert.create({
      userId: quote.technicianId,
      requestId: request._id.toString(),
      requestTitle: isFinal
        ? `Rechazo definitivo: ${request.title}`
        : `Presupuesto rechazado: ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'system',
    });

    socketManager.notifyUser(quote.technicianId, 'quote:rejected', {
      quoteId: quote._id.toString(),
      status: newStatus,
      alert: alert.toObject()
    });
    socketManager.notifyUser(quote.technicianId, 'alert:new', alert.toObject());
    socketManager.notifyUser(req.uid, 'quote:rejected', { quoteId: quote._id.toString(), status: newStatus });
    socketManager.notifyRequest(quote.requestId.toString(), 'quote:rejected', { quoteId: quote._id.toString(), status: newStatus });

    if (socketManager.broadcastEvent) {
      socketManager.broadcastEvent('quote:status', { quoteId: quote._id.toString(), status: newStatus });
    }

    sendPushNotification(quote.technicianId, {
      title: isFinal ? 'Rechazo definitivo' : 'Presupuesto rechazado',
      body: isFinal
        ? `El cliente rechazó definitivamente tu propuesta para: ${request.title}`
        : `El cliente ha rechazado tu propuesta para: ${request.title}. Puedes enviar una contraoferta.`,
      data: {
        type: 'quote_rejected',
        requestId: request._id.toString(),
      },
    });

    res.json({ success: true, status: newStatus });
  } catch (err) {
    next(err);
  }
}

// Technician sends a counter-offer after the client rejected the original quote.
// Updates the existing quote with new pricing and flips status to
// 'counter_offer_sent' so it reappears in the client's active quote list.
async function counterOffer(req, res, next) {
  try {
    const { minPrice, maxPrice, message, estimatedTime } = req.body;

    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    // Only the technician who owns the quote may counter-offer.
    if (quote.technicianId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

    // Counter-offers are only allowed after a (non-final) rejection.
    if (quote.status !== 'rejected') {
      return res.status(400).json({ error: 'A counter-offer can only be sent after the client rejects your quote' });
    }

    const request = await ServiceRequest.findById(quote.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'open' && request.status !== 'assigned') {
      return res.status(400).json({ error: 'Request is no longer accepting quotes' });
    }

    const newMin = minPrice != null ? minPrice : quote.minPrice;
    const newMax = maxPrice != null ? maxPrice : quote.maxPrice;

    quote.minPrice = newMin;
    quote.maxPrice = newMax;
    quote.price = newMin;
    if (message != null) quote.message = message;
    if (estimatedTime != null) quote.estimatedTime = estimatedTime;
    quote.status = 'counter_offer_sent';
    quote.statusUpdatedAt = new Date();
    quote.history.push({ action: 'counter_offer_sent', price: newMin, message: message || '', by: req.uid });
    await quote.save();

    await Activity.create({
      userId: req.uid,
      type: 'quote_sent',
      title: 'Contraoferta enviada',
      description: `Enviaste una contraoferta para "${request.title}"`,
      relatedId: quote._id.toString(),
      xpEarned: 10,
    });

    // Alert the client — reuse 'quoteReceived' so it surfaces like a fresh quote.
    const alert = await Alert.create({
      userId: request.clientId,
      requestId: request._id.toString(),
      requestTitle: `${quote.technicianName} te ha enviado una contraoferta para: ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'quoteReceived',
    });

    socketManager.notifyUser(request.clientId, 'quote:counter_offer', {
      quote: quote.toObject(),
      alert: alert.toObject(),
    });
    socketManager.notifyUser(request.clientId, 'alert:new', alert.toObject());
    socketManager.notifyUser(req.uid, 'quote:counter_offer', { quote: quote.toObject() });
    socketManager.notifyRequest(quote.requestId.toString(), 'quote:counter_offer', quote.toObject());

    sendPushNotification(request.clientId, {
      title: '🔄 Nueva contraoferta',
      body: `${quote.technicianName} ha enviado una contraoferta para: ${request.title}`,
      data: {
        type: 'quote_counter_offer',
        requestId: request._id.toString(),
        quoteId: quote._id.toString(),
      },
    });

    res.json(quote.toObject());
  } catch (err) {
    next(err);
  }
}

// Technician withdraws their own quote.
async function withdrawQuote(req, res, next) {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.technicianId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

    quote.status = 'cancelled';
    quote.statusUpdatedAt = new Date();
    quote.history.push({ action: 'cancelled', by: req.uid, message: 'Withdrawn by technician' });
    await quote.save();

    const request = await ServiceRequest.findByIdAndUpdate(
      quote.requestId,
      { $pull: { interestedTechnicians: req.uid }, $inc: { responsesCount: -1 } },
      { new: true }
    );

    const techName = quote.technicianName || 'El profesional';
    const reqTitle = request?.title || 'tu solicitud';

    // Alerta (campana) para el cliente avisando que el profesional retiró su cotización.
    const alert = await Alert.create({
      userId: quote.clientId,
      requestId: quote.requestId.toString(),
      requestTitle: `${techName} ha retirado su cotización para: ${reqTitle}`,
      requestImageUrl: request?.imageUrls?.[0] || '',
      address: request?.address || '',
      distance: 0,
      type: 'system',
    });

    const withdrawPayload = {
      quoteId: quote._id.toString(),
      status: 'cancelled',
      requestId: quote.requestId.toString(),
    };
    socketManager.notifyUser(quote.clientId, 'quote:withdrawn', { ...withdrawPayload, alert: alert.toObject() });
    socketManager.notifyUser(quote.clientId, 'alert:new', alert.toObject());
    socketManager.notifyRequest(quote.requestId.toString(), 'quote:withdrawn', withdrawPayload);
    if (socketManager.broadcastEvent) {
      socketManager.broadcastEvent('quote:status', withdrawPayload);
    }

    // FCM al cliente: el profesional retiró su cotización.
    sendPushNotification(quote.clientId, {
      title: 'Cotización retirada',
      body: `${techName} ha retirado su cotización para: ${reqTitle}`,
      data: {
        type: 'quote_withdrawn',
        requestId: quote.requestId.toString(),
        quoteId: quote._id.toString(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getQuoteById(req, res, next) {
  try {
    const quote = await Quote.findById(req.params.id).lean();
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const isParticipant = quote.clientId === req.uid || quote.technicianId === req.uid;
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    res.json({
      ...quote,
      id: quote._id.toString(),
      requestId: quote.requestId.toString(),
    });
  } catch (err) {
    next(err);
  }
}

// Returns quotes sent by a specific technician (only own quotes allowed)
async function getQuotesForTechnician(req, res, next) {
  try {
    const quotes = await Quote.find({ technicianId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();

    // Ensure all internal IDs are strings for the frontend
    const formatted = quotes.map(q => ({
      ...q,
      id: q._id.toString(),
      requestId: q.requestId.toString()
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  sendQuote,
  getQuotesForRequest,
  getMyQuotes,
  getQuotesForClient,
  getQuotesForTechnician,
  getQuoteById,
  acceptQuote,
  rejectQuote,
  counterOffer,
  withdrawQuote
};
