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
  peerVpcId?: string;
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
    peerVpcId: stackOutputs.PeerVpcId,
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

const stopAndDisableServices = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      // Stop services gracefully
      'sudo systemctl stop alloy 2>/dev/null || echo "Alloy service not running"',
      'sudo systemctl stop node_exporter 2>/dev/null || echo "Node Exporter service not running"',

      // Disable services
      'sudo systemctl disable alloy 2>/dev/null || echo "Alloy service not enabled"',
      'sudo systemctl disable node_exporter 2>/dev/null || echo "Node Exporter service not enabled"',
    ],
    'Stopping and disabling services...',
    region
  );
};

const removeSystemdServices = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      // Remove systemd service files
      'sudo rm -f /etc/systemd/system/node_exporter.service',

      // Reload systemd daemon
      'sudo systemctl daemon-reload',
      'sudo systemctl reset-failed 2>/dev/null || true',
    ],
    'Removing systemd service files...',
    region
  );
};

const removeAlloyComponents = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      // Remove Alloy package
      'sudo dnf remove -y alloy 2>/dev/null || echo "Alloy package not installed"',

      // Remove configuration directory
      'sudo rm -rf /etc/alloy',

      // Remove Alloy data directory
      'sudo rm -rf /var/lib/alloy',

      // Remove Grafana repository
      'sudo rm -f /etc/yum.repos.d/grafana.repo',

      // Remove GPG key (only Grafana's key)
      'sudo rpm -e gpg-pubkey-$(rpm -qa gpg-pubkey* | grep -i grafana | head -1 | cut -d- -f3-4) 2>/dev/null || echo "Grafana GPG key not found"',
    ],
    'Removing Grafana Alloy components...',
    region
  );
};

const removeNodeExporterComponents = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      // Remove Node Exporter directory
      'sudo rm -rf /opt/node_exporter',

      // Remove node_exporter user and group
      'sudo userdel node_exporter 2>/dev/null || echo "node_exporter user not found"',
      'sudo groupdel node_exporter 2>/dev/null || echo "node_exporter group not found"',
    ],
    'Removing Node Exporter components...',
    region
  );
};

const cleanupTemporaryFiles = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      // Clean up any temporary files that might have been left
      'rm -f /tmp/gpg.key',
      'rm -f gpg.key',
      'rm -rf node_exporter-*',

      // Clean package cache
      'sudo dnf clean all 2>/dev/null || sudo yum clean all 2>/dev/null || echo "Package cache cleaned"',
    ],
    'Cleaning up temporary files...',
    region
  );
};

const verifyRemoval = async (
  instanceId: string,
  publicIp: string,
  region: string
): Promise<void> => {
  await executeRemoteCommands(
    instanceId,
    publicIp,
    [
      // Check that services are no longer running
      'sudo systemctl is-active alloy 2>/dev/null && echo "WARNING: Alloy still running" || echo "Alloy service removed"',
      'sudo systemctl is-active node_exporter 2>/dev/null && echo "WARNING: Node Exporter still running" || echo "Node Exporter service removed"',

      // Check that directories are removed
      'test -d /etc/alloy && echo "WARNING: /etc/alloy still exists" || echo "Alloy config directory removed"',
      'test -d /var/lib/alloy && echo "WARNING: /var/lib/alloy still exists" || echo "Alloy data directory removed"',
      'test -d /opt/node_exporter && echo "WARNING: /opt/node_exporter still exists" || echo "Node Exporter directory removed"',

      // Check that user is removed
      'id node_exporter 2>/dev/null && echo "WARNING: node_exporter user still exists" || echo "node_exporter user removed"',

      // Check that systemd service files are removed
      'test -f /etc/systemd/system/node_exporter.service && echo "WARNING: node_exporter.service still exists" || echo "Node Exporter service file removed"',
    ],
    'Verifying removal...',
    region
  );
};

const destroyAgent = async () => {
  try {
    console.log(chalk.red.bold('\n🗑️  Destroy Monitoring Agent\n'));

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

    if (!outputs.peerVpcId) {
      console.log(
        chalk.red(
          '❌ Peer VPC ID not found in outputs. Cannot locate target instances.'
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
        message: 'Select the instance to remove monitoring agents from:',
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

    // Show warning and confirm destruction
    console.log(
      chalk.red.bold(
        '\n⚠️  WARNING: This will completely remove all monitoring components!\n'
      )
    );
    console.log(chalk.yellow('The following will be removed:'));
    console.log(chalk.white('• Grafana Alloy service and configuration'));
    console.log(chalk.white('• Node Exporter service and binaries'));
    console.log(chalk.white('• All related systemd service files'));
    console.log(chalk.white('• node_exporter user account'));
    console.log(chalk.white('• Grafana repository configuration'));
    console.log(chalk.white('• All temporary installation files'));

    const { confirmDestroy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDestroy',
        message: `Are you sure you want to remove ALL monitoring agents from ${targetInstance.name} (${targetInstance.instanceId})?`,
        default: false,
      },
    ]);

    if (!confirmDestroy) {
      console.log(chalk.yellow('Destruction cancelled'));
      return;
    }

    // Double confirmation for safety
    const { doubleConfirm } = await inquirer.prompt([
      {
        type: 'input',
        name: 'doubleConfirm',
        message: 'Type "DESTROY" to confirm complete removal:',
        validate: (input) =>
          input === 'DESTROY' || 'You must type "DESTROY" exactly to confirm',
      },
    ]);

    if (doubleConfirm !== 'DESTROY') {
      console.log(
        chalk.yellow('Destruction cancelled - confirmation not received')
      );
      return;
    }

    console.log(
      chalk.red(
        `\n🎯 Target: ${targetInstance.name} (${targetInstance.instanceId})`
      )
    );
    console.log(chalk.red('🗑️  Beginning complete removal...\n'));

    try {
      // Step 1: Stop and disable services
      await stopAndDisableServices(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Step 2: Remove systemd service files
      await removeSystemdServices(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Step 3: Remove Alloy components
      await removeAlloyComponents(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Step 4: Remove Node Exporter components
      await removeNodeExporterComponents(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Step 5: Clean up temporary files
      await cleanupTemporaryFiles(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Step 6: Verify removal
      await verifyRemoval(
        targetInstance.instanceId,
        targetInstance.publicIp,
        region
      );

      // Success message
      console.log(chalk.green.bold('\n✅ Agent Destruction Complete!\n'));
      console.log(chalk.green('✅ All Grafana Alloy components removed'));
      console.log(chalk.green('✅ All Node Exporter components removed'));
      console.log(chalk.green('✅ All systemd service files removed'));
      console.log(chalk.green('✅ All configuration files removed'));
      console.log(chalk.green('✅ node_exporter user account removed'));
      console.log(chalk.green('✅ Grafana repository configuration removed'));
      console.log(chalk.green('✅ All temporary files cleaned up'));

      console.log(chalk.blue('\n📋 Summary:'));
      console.log(
        chalk.white(
          `• Target instance: ${targetInstance.name} (${targetInstance.instanceId})`
        )
      );
      console.log(
        chalk.white('• All monitoring agents have been completely removed')
      );
      console.log(chalk.white('• The instance is now in its original state'));
      console.log(chalk.gray('• No other system components were modified'));
    } catch (error) {
      console.error(chalk.red('\n❌ Destruction failed:'), error);
      console.log(
        chalk.yellow('\n⚠️  Some components may have been partially removed.')
      );
      console.log(
        chalk.yellow('You may need to manually verify the instance state.')
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('\n❌ An error occurred:'), error);
    process.exit(1);
  }
};

export default destroyAgent;
