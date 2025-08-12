const Pyroscope = require('@pyroscope/nodejs');

Pyroscope.init({
  serverAddress: 'http://localhost:9999',
  appName: process.env.OTEL_SERVICE_NAME || 'node_app',
});

console.log('Starting Pyroscope Profiler');
Pyroscope.start();
