require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/database');
const { initSocket } = require('./src/socket/socketManager');
const { initRsaKeys } = require('./src/utils/rsaKeys');

const PORT = process.env.PORT || 3000;

// Generate or load RSA key pair for email auth password encryption
initRsaKeys();

const server = http.createServer(app);
initSocket(server);

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[FixRadar] Server running on port ${PORT} (${process.env.NODE_ENV})`);
  });
});
