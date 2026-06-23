const mongoose = require('mongoose');

// Código OTP para verificar la titularidad de un número de teléfono.
// Se asocia al usuario que lo solicita y al número que quiere verificar.
const phoneVerificationCodeSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  phone: { type: String, required: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
}, { timestamps: true });

phoneVerificationCodeSchema.index({ userId: 1 });
// TTL: MongoDB elimina automáticamente los documentos expirados.
phoneVerificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PhoneVerificationCode', phoneVerificationCodeSchema);
