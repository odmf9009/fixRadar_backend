const ChatMessage = require('../entities/ChatMessage');
const ServiceRequest = require('../entities/ServiceRequest');
const Quote = require('../entities/Quote');

async function getMessages(req, res, next) {
  try {
    const { requestId } = req.params;
    const { before, limit = 50 } = req.query;

    const request = await ServiceRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const myQuote = await Quote.findOne({ requestId, technicianId: req.uid });
    const isParticipant = request.clientId === req.uid ||
                          request.technicianId === req.uid ||
                          myQuote != null;
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    const query = { requestId, quoteId: null };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json(messages.reverse());
  } catch (err) {
    next(err);
  }
}

async function getQuoteMessages(req, res, next) {
  try {
    const { quoteId } = req.params;
    const { before, limit = 50 } = req.query;

    const quote = await Quote.findById(quoteId);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const isParticipant = quote.clientId === req.uid || quote.technicianId === req.uid;
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    const query = { quoteId };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json(messages.reverse());
  } catch (err) {
    next(err);
  }
}

async function sendMessage(req, res, next) {
  try {
    const { requestId } = req.params;
    const { text, imageUrl, latitude, longitude, type, senderName } = req.body;

    const request = await ServiceRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.isChatEnabled) return res.status(403).json({ error: 'Chat is disabled' });

    const isParticipant = request.clientId === req.uid || request.technicianId === req.uid;
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    const message = await ChatMessage.create({
      requestId,
      senderId: req.uid,
      senderName: senderName || 'Usuario',
      text: text || '',
      imageUrl: imageUrl || null,
      latitude: latitude || null,
      longitude: longitude || null,
      type: type || 'text',
      readBy: [req.uid],
    });

    await ServiceRequest.findByIdAndUpdate(requestId, {
      lastMessageAt: new Date(),
      lastMessageBy: req.uid,
      lastMessageText: text || (type === 'image' ? '📷 Imagen' : '📍 Ubicación'),
    });

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const { requestId } = req.params;
    await ChatMessage.updateMany(
      { requestId, readBy: { $ne: req.uid } },
      { $addToSet: { readBy: req.uid } }
    );
    await ServiceRequest.findByIdAndUpdate(requestId, {
      [`chatLastReadBy.${req.uid}`]: new Date(),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMessages, getQuoteMessages, sendMessage, markRead };
