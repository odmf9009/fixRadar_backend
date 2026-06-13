const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
  senderId: { type: String, ref: 'User', required: true },
  senderName: { type: String, required: true },
  text: { type: String, default: '' },
  imageUrl: { type: String, default: null },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  type: { type: String, enum: ['text', 'image', 'location'], default: 'text' },
  readBy: [String],
}, {
  timestamps: true,
});

chatMessageSchema.index({ requestId: 1, createdAt: 1 });
chatMessageSchema.index({ senderId: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
