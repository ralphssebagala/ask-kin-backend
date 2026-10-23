/**
 * index.js - Wrapper - keeps backward compatibility
 * PM2 may point to index.js or server.js - both now work
 * Main logic lives in server.js
 */
console.log('index.js wrapper -> loading server.js as MAIN');
module.exports = require('./server.js');

