const mongoose = require('mongoose');

async function connectDB() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }
    const connectionUri = process.env.MONGODB_URI;
    const maskedUri = connectionUri.includes('@')
      ? connectionUri.split('@')[1]
      : connectionUri;

    console.log('[MongoDB] Connecting to:', maskedUri);
    await mongoose.connect(connectionUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('[MongoDB] Connected successfully');
  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Disconnected');
});

module.exports = connectDB;
