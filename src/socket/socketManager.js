const { Server } = require('socket.io');
const admin = require('../config/firebase');
const jwt = require('jsonwebtoken');
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

  // Auth middleware: accepts Firebase ID tokens (Google) or backend JWT (email/password)
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    // Try Firebase first (Google Sign-In)
    if (admin && admin.auth) {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        socket.uid = decoded.uid;
        return next();
      } catch {}
    }

    // Fallback: backend JWT (email/password users)
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fixradar-secret');
      socket.uid = decoded.userId;
      return next();
    } catch {
      return next(new Error('Invalid token'));
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

    // Estado de la app: por defecto el socket nace en primer plano.
    // El cliente lo actualiza con 'app:state' al pasar a segundo plano.
    // Esto decide si enviamos FCM (solo cuando NO está en primer plano).
    socket.data.foreground = true;
    socket.on('app:state', (state) => {
      socket.data.foreground = state === 'foreground';
    });

    // --- CHAT EVENTS ---

    socket.on('chat:join', (requestId) => {
      socket.join(`chat:${requestId}`);
    });

    socket.on('chat:leave', (requestId) => {
      socket.leave(`chat:${requestId}`);
    });

    socket.on('chat:message', async (data) => {
      try {
        const { requestId, quoteId, text, imageUrl, latitude, longitude, type, senderName } = data;

        let recipientId = null;
        let msgRequestId = requestId || null;

        const message = await ChatMessage.create({
          requestId: requestId || null,
          quoteId: quoteId || null,
          senderId: uid,
          senderName: senderName || 'Usuario',
          text: text || '',
          imageUrl: imageUrl || null,
          latitude: latitude || null,
          longitude: longitude || null,
          type: type || 'text',
          readBy: [uid],
        });

        if (quoteId) {
          const Quote = require('../entities/Quote');
          const quote = await Quote.findById(quoteId);
          if (quote) {
            recipientId = uid === quote.clientId.toString() ? quote.technicianId : quote.clientId;
            msgRequestId = quote.requestId;
          }
        } else if (requestId) {
          const request = await ServiceRequest.findByIdAndUpdate(requestId, {
            lastMessageAt: new Date(),
            lastMessageBy: uid,
            lastMessageText: text || (type === 'image' ? '📷 Imagen' : '📍 Ubicación'),
          });
          if (request) {
            recipientId = uid === request.clientId ? request.technicianId : request.clientId;
          }
        }

        if (recipientId) {
          const { sendPushNotification } = require('../utils/notifications');
          sendPushNotification(recipientId.toString(), {
            title: `Mensaje de ${senderName || 'Usuario'}`,
            body: text || (type === 'image' ? '📷 Te envió una imagen' : '📍 Te envió una ubicación'),
            data: {
              type: 'chat_message',
              requestId: msgRequestId ? msgRequestId.toString() : '',
              quoteId: quoteId || '',
            },
          });

          // Notify recipient in-app for bell shake (if they're in foreground on another screen)
          notifyUser(recipientId.toString(), 'chat:incoming', {
            requestId: requestId || null,
            quoteId: quoteId || null,
            senderName: senderName || 'Usuario',
            text: text || '...',
          });

          // Campana: UNA alerta por conversación (se actualiza, no se duplica).
          // Se marca leída cuando el destinatario abre ese chat.
          try {
            const preview = text || (type === 'image' ? '📷 Imagen' : '📍 Ubicación');
            const convFilter = {
              userId: recipientId.toString(),
              type: 'message',
              requestId: msgRequestId ? msgRequestId.toString() : null,
              quoteId: quoteId || null,
            };
            const msgAlert = await Alert.findOneAndUpdate(
              convFilter,
              {
                requestTitle: `${senderName || 'Mensaje'}: ${preview}`,
                requestImageUrl: '',
                address: '',
                distance: 0,
                isRead: false,
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            notifyUser(recipientId.toString(), 'alert:new', msgAlert.toObject());
          } catch (e) {
            console.error('[Alert] message alert error:', e.message);
          }
        }

        const roomKey = quoteId ? `chat:quote:${quoteId}` : `chat:${requestId}`;
        io.to(roomKey).emit('chat:message', {
          id: message._id.toString(),
          requestId: requestId || null,
          quoteId: quoteId || null,
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
      // Only update lastSeen — isOnline is controlled manually by the technician's radar toggle
      await User.findByIdAndUpdate(uid, {
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
