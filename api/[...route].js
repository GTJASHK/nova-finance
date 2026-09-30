const server = require('../server.cjs');

module.exports = (request, response) => server.emit('request', request, response);
