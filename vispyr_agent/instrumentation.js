// Metrics & Traces

const opentelemetry = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-grpc');
const {
  OTLPMetricExporter,
} = require('@opentelemetry/exporter-metrics-otlp-grpc');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

const sdk = new opentelemetry.NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

console.log('Starting OTLP Instrumentation');
sdk.start();

// Profiles

const Pyroscope = require('@pyroscope/nodejs');

Pyroscope.init({
  serverAddress: 'http://localhost:9999',
  appName: process.env.OTEL_SERVICE_NAME || 'node_app',
});

console.log('Starting Pyroscope Profiler');
Pyroscope.start();
