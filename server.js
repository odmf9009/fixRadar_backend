require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/database');
const { initSocket } = require('./src/socket/socketManager');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
initSocket(server);

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[FixRadar] Server running on port ${PORT} (${process.env.NODE_ENV})`);
  });
});
