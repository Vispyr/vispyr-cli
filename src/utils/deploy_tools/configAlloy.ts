import ora from 'ora';
import path from 'path';
import fs from 'fs';

const writeConfigAlloy = async (privateIp: string): Promise<void> => {
  try {
    const spinner = ora('Generating config.alloy file...').start();

    const configContent = generateConfigAlloy(privateIp);
    const configPath = path.resolve(
      process.cwd(),
      'vispyr_agent',
      'config.alloy'
    );

    const vispyrAgentDir = path.dirname(configPath);
    if (!fs.existsSync(vispyrAgentDir)) {
      fs.mkdirSync(vispyrAgentDir, { recursive: true });
    }

    fs.writeFileSync(configPath, configContent, 'utf8');

    spinner.succeed(
      `config.alloy created at ${configPath} with private IP: ${privateIp}`
    );
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to create config.alloy file: ${error.message}`);
    } else {
      throw new Error(`Failed to create config.alloy file: ${String(error)}`);
    }
  }
};

const generateConfigAlloy = (privateIp: string): string => {
  return `// Receivers
otelcol.receiver.otlp "default" {
  grpc {
    endpoint = "0.0.0.0:4317"
  }

  http {
    endpoint = "0.0.0.0:4318"
  }

  output {
    traces = [ otelcol.connector.spanmetrics.default.input, otelcol.exporter.otlp.gateway_collector.input]
    metrics = [otelcol.exporter.otlp.gateway_collector.input]
  }
}

prometheus.scrape "node_metrics" {
  targets = [{ __address__ = "localhost:9100" }]
  forward_to = [prometheus.remote_write.gateway_collector.receiver]
  scrape_interval = "15s"
}

pyroscope.receive_http "profiles_sdk" {
  http {
    listen_address = "0.0.0.0"
    listen_port = 9999
  }

  forward_to = [pyroscope.write.gateway_collector.receiver]
}

// Processors
otelcol.processor.batch "sdk_telemetry" {
  output {
    traces = [otelcol.exporter.otlp.gateway_collector.input]
    metrics = [otelcol.exporter.otlp.gateway_collector.input]
  }
}

otelcol.connector.spanmetrics "default" {
  dimension {
    name = "http.method"
    default = "GET"
  }
  dimension {
    name = "http.target"
  }
  histogram {
    explicit {
      buckets = ["50ms", "100ms", "250ms", "1s", "5s", "10s"]
    }
  }
  metrics_flush_interval = "15s"
  namespace = "traces.spanmetrics"
  output {
    metrics = [otelcol.exporter.otlp.gateway_collector.input]
  }
}

// Exporters
prometheus.remote_write "gateway_collector" {
  endpoint {
    url = "http://${privateIp}:9090/api/v1/metrics/write"
  }
}

otelcol.exporter.otlp "gateway_collector" {
  client {
    endpoint = "http://${privateIp}:4317"
    tls {
      insecure = true
      insecure_skip_verify = true
    }
  }
}

pyroscope.write "gateway_collector" {
  endpoint {
    url = "http://${privateIp}:9999"
  }
}

livedebugging {
  enabled = true
}`;
};

export default writeConfigAlloy;
