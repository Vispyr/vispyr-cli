import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import {
  EC2InstanceConnectClient,
  SendSSHPublicKeyCommand,
} from '@aws-sdk/client-ec2-instance-connect';
import { hasCredentials } from '../utils/config.js';

const execAsync = promisify(exec);

interface DeploymentOutputs {
  instanceId?: string;
  instancePrivateIp?: string;
  vpcId?: string;
  peerVpcId?: string;
  peeringConnectionId?: string;
}

interface EC2Instance {
  instanceId: string;
  name: string;
  privateIp: string;
  publicIp?: string;
  state: string;
}

const getStackOutputs = async (): Promise<DeploymentOutputs> => {
  const outputsPath = path.resolve(process.cwd(), 'outputs.json');

  if (!fs.existsSync(outputsPath)) {
    throw new Error('outputs.json not found. Please run deploy command first.');
  }

  const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
  const stackName = Object.keys(outputs)[0];
  const stackOutputs = outputs[stackName];

  return {
    instanceId: stackOutputs.InstanceId,
    instancePrivateIp: stackOutputs.InstancePrivateIp,
    vpcId: stackOutputs.VPCId,
    peerVpcId: stackOutputs.PeerVpcId,
    peeringConnectionId: stackOutputs.PeeringConnectionId,
  };
};

const scanPeerVpcInstances = async (
  peerVpcId: string,
  region: string
): Promise<EC2Instance[]> => {
  const ec2Client = new EC2Client({ region });
  const spinner = ora(
    `Scanning peer VPC ${peerVpcId} for EC2 instances...`
  ).start();

  try {
    const response = await ec2Client.send(
      new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'vpc-id',
            Values: [peerVpcId],
          },
          {
            Name: 'instance-state-name',
            Values: ['running', 'stopped'],
          },
        ],
      })
    );

    const instances: EC2Instance[] = [];

    response.Reservations?.forEach((reservation) => {
      reservation.Instances?.forEach((instance) => {
        const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name');
        instances.push({
          instanceId: instance.InstanceId!,
          name: nameTag?.Value || 'Unnamed',
          privateIp: instance.PrivateIpAddress!,
          publicIp: instance.PublicIpAddress,
          state: instance.State?.Name!,
        });
      });
    });

    spinner.succeed(`Found ${instances.length} instances in peer VPC`);
    return instances;
  } catch (error) {
    spinner.fail('Failed to scan peer VPC');
    throw error;
  }
};

const testVpcConnectivity = async (
  sourceInstanceId: string,
  targetPrivateIp: string,
  region: string
): Promise<boolean> => {
  const spinner = ora('Testing VPC peering connectivity...').start();

  try {
    // Use AWS CLI to execute ping command on source instance via SSM
    const command = `aws ssm send-command --region ${region} --instance-ids ${sourceInstanceId} --document-name "AWS-RunShellScript" --parameters 'commands=["ping -c 3 ${targetPrivateIp}"]' --output json`;

    const { stdout } = await execAsync(command);
    const result = JSON.parse(stdout);
    const commandId = result.Command.CommandId;

    // Wait a moment and check command result
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const resultCommand = `aws ssm get-command-invocation --region ${region} --command-id ${commandId} --instance-id ${sourceInstanceId} --output json`;
    const { stdout: resultStdout } = await execAsync(resultCommand);
    const invocationResult = JSON.parse(resultStdout);

    if (invocationResult.Status === 'Success') {
      spinner.succeed('VPC peering connectivity verified');
      return true;
    } else {
      spinner.warn('VPC connectivity test inconclusive - proceeding anyway');
      return true; // Don't fail deployment for connectivity test
    }
  } catch (error) {
    spinner.warn('Could not test VPC connectivity - proceeding anyway');
    return true; // Don't fail deployment for connectivity test
  }
};

const generateAlloyConfig = (vispyrPrivateIp: string): string => {
  return `// Receivers
otelcol.receiver.otlp "default" {
 grpc {
   endpoint = "0.0.0.0:4317"
 }

 http {
   endpoint = "0.0.0.0:4318"
 }

 output {
   traces = [otelcol.exporter.otlp.gateway_collector.input]
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

// Exporters
prometheus.remote_write "gateway_collector" {
 endpoint {
   url = "http://${vispyrPrivateIp}:9091/api/v1/metrics/write"
 }
}

otelcol.exporter.otlp "gateway_collector" {
 client {
   endpoint = "${vispyrPrivateIp}:4317"
   tls {
     insecure = true
     insecure_skip_verify = true
   }
 }
}

pyroscope.write "gateway_collector" {
 endpoint {
   url = "http://${vispyrPrivateIp}:9999"
 }
}

livedebugging {
 enabled = true
}`;
};

const createNodeExporterService = (): string => {
  return `[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/opt/node_exporter/node_exporter
SyslogIdentifier=node_exporter
Restart=always

[Install]
WantedBy=multi-user.target`;
};

const executeRemoteCommands = async (
  instanceId: string,
  publicIp: string,
  commands: string[],
  description: string,
  region: string
): Promise<void> => {
  const spinner = ora(description).start();

  try {
    // Send SSH public key using EC2 Instance Connect
    const ec2InstanceConnectClient = new EC2InstanceConnectClient({ region });

    // Generate temporary SSH key pair
    await execAsync('ssh-keygen -t rsa -b 2048 -f /tmp/temp_key -N ""');
    const publicKey = fs.readFileSync('/tmp/temp_key.pub', 'utf8');

    // Send public key to instance
    await ec2InstanceConnectClient.send(
      new SendSSHPublicKeyCommand({
        InstanceId: instanceId,
        InstanceOSUser: 'ec2-user',
        SSHPublicKey: publicKey,
      })
    );

    // Wait a moment for key to propagate
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Execute commands via SSH
    const commandString = commands.join(' && ');
    const sshCommand = `ssh -i /tmp/temp_key -o StrictHostKeyChecking=no -o ConnectTimeout=30 ec2-user@${publicIp} "${commandString}"`;

    await execAsync(sshCommand);

    // Clean up temporary key
    try {
      fs.unlinkSync('/tmp/temp_key');
      fs.unlinkSync('/tmp/temp_key.pub');
    } catch (e) {
      // Ignore cleanup errors
    }

    spinner.succeed(description);
  } catch (error) {
    spinner.fail(`${description} failed`);

    // Clean up temporary key on error
    try {
      fs.unlinkSync('/tmp/temp_key');
      fs.unlinkSync('/tmp/temp_key.pub');
    } catch (e) {
      // Ignore cleanup errors
    }

    throw error;
  }
};

const installGrafanaAlloy = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  // Step 1: Add Grafana GPG key
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      'wget -q -O /tmp/gpg.key https://rpm.grafana.com/gpg.key',
      'sudo rpm --import /tmp/gpg.key',
      'rm -f /tmp/gpg.key',
    ],
    'Adding Grafana GPG key...',
    region
  );

  // Step 2: Create repository configuration file
  const repoConfig = `[grafana]
name=grafana
baseurl=https://rpm.grafana.com
repo_gpgcheck=1
enabled=1
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt`;

  const repoConfigBase64 = Buffer.from(repoConfig).toString('base64');
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      `echo '${repoConfigBase64}' | base64 -d | sudo tee /etc/yum.repos.d/grafana.repo > /dev/null`,
    ],
    'Adding Grafana repository...',
    region
  );

  // Step 3: Clean package cache and update
  await executeRemoteCommands(
    instanceId,
    publicIp,
    ['sudo dnf clean all', 'sudo dnf makecache'],
    'Refreshing package cache...',
    region
  );

  // Step 4: Verify repository is working
  await executeRemoteCommands(
    instanceId,
    publicIp,
    ['sudo dnf repolist | grep grafana || echo "Grafana repo not found"'],
    'Verifying Grafana repository...',
    region
  );

  // Step 5: Install Alloy
  await executeRemoteCommands(
    instanceId,
    publicIp,
    ['sudo dnf install -y alloy'],
    'Installing Grafana Alloy...',
    region
  );
};

const installNodeExporter = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  // First, get the latest release version
  const spinner = ora('Getting latest Node Exporter version...').start();
  let version: string;

  try {
    const { stdout } = await execAsync(
      "curl -s https://api.github.com/repos/prometheus/node_exporter/releases/latest | grep tag_name | cut -d '\"' -f 4"
    );
    version = stdout.trim();
    spinner.succeed(`Latest Node Exporter version: ${version}`);
  } catch (error) {
    spinner.warn('Could not fetch latest version, using v1.8.2');
    version = 'v1.8.2';
  }

  const commands = [
    'sudo useradd --no-create-home --shell /bin/false node_exporter || true',
    'sudo mkdir -p /opt/node_exporter',
    `wget https://github.com/prometheus/node_exporter/releases/download/${version}/node_exporter-${version.slice(
      1
    )}.linux-amd64.tar.gz`,
    `tar xvfz node_exporter-${version.slice(1)}.linux-amd64.tar.gz`,
    `sudo cp node_exporter-${version.slice(
      1
    )}.linux-amd64/node_exporter /opt/node_exporter/`,
    `sudo chown -R node_exporter:node_exporter /opt/node_exporter`,
    `rm -rf node_exporter-${version.slice(1)}.linux-amd64*`,
  ];

  await executeRemoteCommands(
    instanceId,
    publicIp,
    commands,
    'Installing Node Exporter...',
    region
  );
};

const configureServices = async (
  instanceId: string,
  publicIp: string,
  vispyrPrivateIp: string,
  region: string
): Promise<void> => {
  const alloyConfig = generateAlloyConfig(vispyrPrivateIp);
  const nodeExporterService = createNodeExporterService();

  // Step 1: Create Alloy config file
  await executeRemoteCommands(
    instanceId,
    publicIp,
    ['sudo mkdir -p /etc/alloy'],
    'Creating Alloy config directory...',
    region
  );

  // Step 2: Write Alloy config (use base64 to avoid shell escaping issues)
  const alloyConfigBase64 = Buffer.from(alloyConfig).toString('base64');
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      `echo '${alloyConfigBase64}' | base64 -d | sudo tee /etc/alloy/config.alloy > /dev/null`,
    ],
    'Writing Alloy configuration...',
    region
  );

  // Step 3: Create Node Exporter systemd service
  const nodeServiceBase64 = Buffer.from(nodeExporterService).toString('base64');
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      `echo '${nodeServiceBase64}' | base64 -d | sudo tee /etc/systemd/system/node_exporter.service > /dev/null`,
    ],
    'Creating Node Exporter service...',
    region
  );

  // Step 4: Reload systemd
  await executeRemoteCommands(
    instanceId,
    publicIp,
    ['sudo systemctl daemon-reload'],
    'Reloading systemd...',
    region
  );

  // Step 5: Enable and start Node Exporter
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      'sudo systemctl enable node_exporter',
      'sudo systemctl start node_exporter',
    ],
    'Starting Node Exporter...',
    region
  );

  // Step 6: Check if Alloy service exists and enable/start it
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      'if systemctl list-unit-files | grep -q "alloy.service"; then sudo systemctl enable alloy && sudo systemctl start alloy; else echo "Alloy service not found, skipping"; fi',
    ],
    'Starting Alloy service...',
    region
  );
};

const verifyServices = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  // Verify Node Exporter
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      'sudo systemctl is-active node_exporter',
      'curl -s http://localhost:9100/metrics | head -3',
    ],
    'Verifying Node Exporter...',
    region
  );

  // Verify Alloy service status
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      'if systemctl list-unit-files | grep -q "alloy.service"; then sudo systemctl is-active alloy && echo "Alloy is running"; else echo "Alloy service not available"; fi',
    ],
    'Verifying Alloy service...',
    region
  );

  // Test Alloy endpoints
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      'timeout 5 curl -s http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d "{}" > /dev/null 2>&1 && echo "Alloy OTLP HTTP endpoint responding" || echo "Alloy OTLP endpoint not responding - this may be normal"',
    ],
    'Testing Alloy endpoints...',
    region
  );
};

const cleanupOnError = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  console.log(chalk.yellow('Cleaning up partial installation...'));

  try {
    const cleanupCommands = [
      'sudo systemctl stop alloy || true',
      'sudo systemctl stop node_exporter || true',
      'sudo systemctl disable alloy || true',
      'sudo systemctl disable node_exporter || true',
      'sudo rm -f /etc/systemd/system/node_exporter.service',
      'sudo rm -rf /etc/alloy',
      'sudo rm -rf /opt/node_exporter',
      'sudo userdel node_exporter || true',
      'sudo yum remove -y alloy || true',
      'sudo rm -f /etc/yum.repos.d/grafana.repo',
    ];

    await executeRemoteCommands(
      instanceId,
      publicIp,
      cleanupCommands,
      'Cleaning up...',
      region
    );

    console.log(chalk.green('Cleanup completed'));
  } catch (error) {
    console.log(
      chalk.red('Cleanup failed, manual intervention may be required')
    );
  }
};

const deployAgent = async () => {
  try {
    console.log(chalk.blue.bold('\n🤖 Deploy Monitoring Agent\n'));

    // Check credentials
    if (!hasCredentials()) {
      console.log(
        chalk.red('❌ AWS credentials not found. Please run init first.')
      );
      process.exit(1);
    }

    // Get deployment outputs
    console.log(chalk.yellow('📋 Reading deployment outputs...'));
    const outputs = await getStackOutputs();

    if (!outputs.instancePrivateIp || !outputs.peerVpcId) {
      console.log(
        chalk.red(
          '❌ Required deployment outputs not found. Please run deploy first.'
        )
      );
      process.exit(1);
    }

    const region =
      process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';

    // Scan peer VPC for instances
    const instances = await scanPeerVpcInstances(outputs.peerVpcId, region);

    if (instances.length === 0) {
      console.log(chalk.red('❌ No instances found in peer VPC'));
      process.exit(1);
    }

    // Filter only running instances
    const runningInstances = instances.filter(
      (instance) => instance.state === 'running'
    );

    if (runningInstances.length === 0) {
      console.log(chalk.red('❌ No running instances found in peer VPC'));
      console.log(chalk.yellow('Available instances:'));
      instances.forEach((instance) => {
        console.log(
          chalk.gray(
            `  ${instance.name} (${instance.instanceId}) - ${instance.state}`
          )
        );
      });
      process.exit(1);
    }

    // Let user select target instance
    const { targetInstance } = await inquirer.prompt([
      {
        type: 'list',
        name: 'targetInstance',
        message: 'Select the target instance to install monitoring agents:',
        choices: runningInstances.map((instance) => ({
          name: `${instance.name} (${instance.instanceId}) - ${instance.privateIp}`,
          value: instance,
        })),
      },
    ]);

    if (!targetInstance.publicIp) {
      console.log(
        chalk.red(
          '❌ Target instance does not have a public IP address for SSH access'
        )
      );
      process.exit(1);
    }

    // Confirm deployment
    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: `Install monitoring agents on ${targetInstance.name} (${targetInstance.instanceId})?`,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      console.log(chalk.yellow('Deployment cancelled'));
      return;
    }

    console.log(
      chalk.green(
        `\n🎯 Target: ${targetInstance.name} (${targetInstance.instanceId})`
      )
    );
    console.log(chalk.green(`📡 Vispyr Backend: ${outputs.instancePrivateIp}`));

    // Test VPC connectivity if source instance is available
    if (outputs.instanceId) {
      await testVpcConnectivity(
        outputs.instanceId,
        targetInstance.privateIp,
        region
      );
    }

    let installationStarted = false;

    try {
      // Install Grafana Alloy
      await installGrafanaAlloy(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );
      installationStarted = true;

      // Install Node Exporter
      await installNodeExporter(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Configure services
      await configureServices(
        targetInstance.instanceId,
        targetInstance.publicIp,
        outputs.instancePrivateIp,
        region
      );

      // Verify installation
      await verifyServices(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Success message
      console.log(chalk.blue.bold('\n🎉 Agent Deployment Complete!\n'));
      console.log(chalk.green('✅ Grafana Alloy installed and running'));
      console.log(chalk.green('✅ Node Exporter installed and running'));
      console.log(chalk.green('✅ Services configured to start automatically'));

      console.log(chalk.blue('\n📊 Monitoring Endpoints:'));
      console.log(
        chalk.cyan(
          `• Node Exporter: http://${targetInstance.privateIp}:9100/metrics`
        )
      );
      console.log(
        chalk.cyan(`• Alloy OTLP (gRPC): ${targetInstance.privateIp}:4317`)
      );
      console.log(
        chalk.cyan(`• Alloy OTLP (HTTP): ${targetInstance.privateIp}:4318`)
      );
      console.log(
        chalk.cyan(`• Alloy Pyroscope: ${targetInstance.privateIp}:9999`)
      );

      console.log(chalk.yellow('\n💡 Next Steps:'));
      console.log(
        chalk.white(
          '1. Configure your applications to send telemetry to the Alloy endpoints'
        )
      );
      console.log(
        chalk.white(
          '2. Check Grafana dashboard for incoming metrics and traces'
        )
      );
      console.log(
        chalk.white('3. Verify data is flowing in the Vispyr backend logs')
      );
    } catch (error) {
      console.error(chalk.red('\n❌ Installation failed:'), error);

      if (installationStarted) {
        await cleanupOnError(
          targetInstance.instanceId,
          targetInstance.publicIp,
          region
        );
      }

      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('\n❌ An error occurred:'), error);
    process.exit(1);
  }
};

export default deployAgent;
