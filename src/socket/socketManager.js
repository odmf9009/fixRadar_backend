const { Server } = require('socket.io');
const admin = require('../config/firebase');
const User = require('../entities/User');
const ChatMessage = require('../entities/ChatMessage');
const ServiceRequest = require('../entities/ServiceRequest');
const Alert = require('../entities/Alert');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Firebase token auth middleware for socket
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      socket.uid = decoded.uid;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.uid;
    console.log(`[Socket] Connected: ${uid}`);

    // Mark user online
    await User.findByIdAndUpdate(uid, {
      isOnline: true,
      presenceStatus: 'online',
      lastSeen: new Date(),
    });

    // Join personal room for targeted notifications
    socket.join(`user:${uid}`);

    // --- CHAT EVENTS ---

    socket.on('chat:join', (requestId) => {
      socket.join(`chat:${requestId}`);
    });

    socket.on('chat:leave', (requestId) => {
      socket.leave(`chat:${requestId}`);
    });

    socket.on('chat:message', async (data) => {
      try {
        const { requestId, text, imageUrl, latitude, longitude, type, senderName } = data;

        const message = await ChatMessage.create({
          requestId,
          senderId: uid,
          senderName: senderName || 'Usuario',
          text: text || '',
          imageUrl: imageUrl || null,
          latitude: latitude || null,
          longitude: longitude || null,
          type: type || 'text',
          readBy: [uid],
        });

        // Update request last message metadata
        await ServiceRequest.findByIdAndUpdate(requestId, {
          lastMessageAt: new Date(),
          lastMessageBy: uid,
          lastMessageText: text || (type === 'image' ? '📷 Imagen' : '📍 Ubicación'),
        });

        io.to(`chat:${requestId}`).emit('chat:message', {
          id: message._id.toString(),
          requestId,
          senderId: uid,
          senderName: message.senderName,
          text: message.text,
          imageUrl: message.imageUrl,
          latitude: message.latitude,
          longitude: message.longitude,
          type: message.type,
          createdAt: message.createdAt.toISOString(),
        });
      } catch (err) {
        socket.emit('chat:error', { message: err.message });
      }
    });

    socket.on('chat:read', async ({ requestId }) => {
      try {
        await ChatMessage.updateMany(
          { requestId, readBy: { $ne: uid } },
          { $addToSet: { readBy: uid } }
        );
        await ServiceRequest.findByIdAndUpdate(requestId, {
          [`chatLastReadBy.${uid}`]: new Date(),
        });
        io.to(`chat:${requestId}`).emit('chat:read', { requestId, userId: uid });
      } catch (err) {
        socket.emit('chat:error', { message: err.message });
      }
    });

    // --- LOCATION EVENTS (technician GPS tracking) ---

    socket.on('location:update', async ({ latitude, longitude }) => {
      try {
        await User.findByIdAndUpdate(uid, {
          location: { type: 'Point', coordinates: [longitude, latitude] },
          lastLocationUpdate: new Date(),
        });
        // Broadcast to rooms where this technician has active requests
        socket.broadcast.emit(`technician:location:${uid}`, { latitude, longitude, uid });
      } catch (err) {
        // silently ignore
      }
    });

    // --- SERVICE REQUEST EVENTS ---

    socket.on('request:join', (requestId) => {
      socket.join(`request:${requestId}`);
    });

    socket.on('request:leave', (requestId) => {
      socket.leave(`request:${requestId}`);
    });

    // --- DISCONNECT ---

    socket.on('disconnect', async () => {
      console.log(`[Socket] Disconnected: ${uid}`);
      await User.findByIdAndUpdate(uid, {
        isOnline: false,
        presenceStatus: 'offline',
        lastSeen: new Date(),
      });
    });
  });

  console.log('[Socket.io] Initialized');
  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

// Emit a real-time event to a specific user
function notifyUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

// Emit to all subscribers of a service request
function notifyRequest(requestId, event, data) {
  if (io) io.to(`request:${requestId}`).emit(event, data);
}

function broadcastEvent(event, data) {
  if (io) io.emit(event, data);
}

module.exports = { initSocket, getIO, notifyUser, notifyRequest, broadcastEvent };
