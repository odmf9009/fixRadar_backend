const Quote = require('../entities/Quote');
const ServiceRequest = require('../entities/ServiceRequest');
const User = require('../entities/User');
const Alert = require('../entities/Alert');
const Activity = require('../entities/Activity');
const { notifyUser, notifyRequest } = require('../socket/socketManager');
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
      requestTitle: `Nuevo presupuesto para: ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'directQuote',
    });

    notifyUser(request.clientId, 'quote:new', {
      quote: quote.toObject(),
      alert: alert.toObject(),
    });
    notifyRequest(requestId, 'quote:new', quote.toObject());

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
    res.json(quotes);
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

    notifyUser(quote.technicianId, 'quote:accepted', {
      quote: quote.toObject(),
      request: request.toObject(),
      alert: alert.toObject(),
    });
    notifyRequest(request._id.toString(), 'request:assigned', request.toObject());

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

    quote.status = 'rejected';
    quote.statusUpdatedAt = new Date();
    quote.history.push({ action: 'rejected', by: req.uid, message: req.body.reason || '' });
    await quote.save();

    const alert = await Alert.create({
      userId: quote.technicianId,
      requestId: request._id.toString(),
      requestTitle: `Presupuesto rechazado: ${request.title}`,
      requestImageUrl: request.imageUrls?.[0] || '',
      address: request.address,
      distance: 0,
      type: 'system',
    });

    notifyUser(quote.technicianId, 'quote:rejected', {
      quoteId: quote._id.toString(),
      alert: alert.toObject()
    });
    notifyUser(req.uid, 'quote:rejected', { quoteId: quote._id.toString() });
    notifyRequest(quote.requestId.toString(), 'quote:rejected', { quoteId: quote._id.toString() });

    sendPushNotification(quote.technicianId, {
      title: 'Presupuesto rechazado',
      body: `El cliente ha rechazado tu propuesta para: ${request.title}`,
      data: {
        type: 'quote_rejected',
        requestId: request._id.toString(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  sendQuote,
  getQuotesForRequest,
  getMyQuotes,
  getQuotesForClient,
  acceptQuote,
  rejectQuote
};
