const Pyroscope = require('@pyroscope/nodejs');

Pyroscope.init({
  serverAddress: 'http://localhost:9999',
  appName: 'Telemetry-Test-App',
});

console.log('Starting Pyroscope Profiler');
Pyroscope.start();
