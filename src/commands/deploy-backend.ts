import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVpcsCommand,
  AcceptVpcPeeringConnectionCommand,
} from '@aws-sdk/client-ec2';
import init from './init.js';
import { hasCredentials } from '../utils/config.js';

const execAsync = promisify(exec);

const outputsPath = path.resolve(process.cwd(), 'outputs.json');

interface DeploymentOutputs {
  instanceId?: string;
  publicIp?: string;
  httpsEndpoint?: string;
  vpcId?: string;
  peeringConnectionId?: string;
  peerVpcId?: string;
}

const getStackOutputs = async (): Promise<DeploymentOutputs> => {
  try {
    // Get outputs from CDK deployment
    const { stdout } = await execAsync('npx cdk list');
    const stacks = stdout.trim().split('\n');

    if (stacks.length === 0) {
      throw new Error('No CDK stacks found');
    }

    if (fs.existsSync(outputsPath)) {
      const outputs = JSON.parse(fs.readFileSync('outputs.json', 'utf8'));
      const stackName = Object.keys(outputs)[0];
      const stackOutputs = outputs[stackName];

      return {
        instanceId: stackOutputs.InstanceId,
        publicIp: stackOutputs.InstancePublicIP,
        httpsEndpoint: stackOutputs.HTTPSEndpoint,
        vpcId: stackOutputs.VpcId,
        peeringConnectionId: stackOutputs.PeeringConnectionId,
        peerVpcId: stackOutputs.PeerVpcId,
      };
    }

    return {};
  } catch (error) {
    console.warn(
      chalk.yellow('Could not retrieve stack outputs automatically')
    );
    return {};
  }
};

const validatePeerVpc = async (
  peerVpcId: string,
  region: string
): Promise<boolean> => {
  try {
    const ec2Client = new EC2Client({ region });
    const response = await ec2Client.send(
      new DescribeVpcsCommand({
        VpcIds: [peerVpcId],
      })
    );

    const vpc = response.Vpcs?.[0];
    if (!vpc) {
      return false;
    }

    console.log(
      chalk.green(`✅ Found peer VPC: ${peerVpcId} (${vpc.CidrBlock})`)
    );
    return true;
  } catch (error) {
    console.error(chalk.red(`❌ Could not find VPC ${peerVpcId}:`, error));
    return false;
  }
};

const acceptPeeringConnection = async (
  peeringConnectionId: string,
  region: string
): Promise<void> => {
  try {
    const ec2Client = new EC2Client({ region });
    const spinner = ora('Accepting VPC peering connection...').start();

    await ec2Client.send(
      new AcceptVpcPeeringConnectionCommand({
        VpcPeeringConnectionId: peeringConnectionId,
      })
    );

    spinner.succeed(`VPC peering connection ${peeringConnectionId} accepted`);
  } catch (error) {
    console.error(chalk.red('Failed to accept peering connection:'), error);
    throw error;
  }
};

const checkEnvFile = (): { hasEnv: boolean; peerVpcId?: string } => {
  const envPath = path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    return { hasEnv: false };
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const peerVpcMatch = envContent.match(/PEER_VPC_ID=(.+)/);

  if (peerVpcMatch) {
    const peerVpcId = peerVpcMatch[1].trim().replace(/['"]/g, '');
    return { hasEnv: true, peerVpcId };
  }

  return { hasEnv: true };
};

const waitForInstanceReady = async (
  instanceId: string,
  region: string
): Promise<void> => {
  const ec2Client = new EC2Client({ region });
  const spinner = ora('Waiting for EC2 instance to be ready...').start();

  let attempts = 0;
  const maxAttempts = 30; // 5 minutes with 10-second intervals

  while (attempts < maxAttempts) {
    try {
      const response = await ec2Client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        })
      );

      const instance = response.Reservations?.[0]?.Instances?.[0];
      if (instance?.State?.Name === 'running' && instance?.PublicIpAddress) {
        spinner.succeed(
          `Instance ${instanceId} is ready at ${instance.PublicIpAddress}`
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    } catch (error) {
      spinner.fail('Failed to check instance status');
      throw error;
    }
  }

  spinner.fail('Instance did not become ready within timeout');
  throw new Error('Instance readiness timeout');
};

const waitForHTTPSReady = async (httpsEndpoint: string): Promise<void> => {
  const spinner = ora(
    'Waiting for HTTPS endpoint and application deployment...'
  ).start();

  let attempts = 0;
  const maxAttempts = 90; // 15 minutes with 10-second intervals

  while (attempts < maxAttempts) {
    try {
      // Use curl to test HTTPS endpoint, accepting self-signed certificates
      const { stdout } = await execAsync(
        `curl -k -s -o /dev/null -w "%{http_code}" ${httpsEndpoint}/api/health || echo "000"`
      );

      if (stdout.trim() === '200') {
        spinner.succeed('HTTPS endpoint is ready and Grafana is responding');
        return;
      }

      const minutes = Math.floor((attempts * 10) / 60);
      const seconds = (attempts * 10) % 60;
      spinner.text = `Waiting for HTTPS endpoint... (${minutes}:${seconds
        .toString()
        .padStart(2, '0')} elapsed)`;

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    } catch (error) {
      // Continue trying even if curl fails
      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    }
  }

  spinner.warn(
    'HTTPS endpoint monitoring timeout - deployment may still be in progress'
  );
};

const showServiceInfo = (
  httpsEndpoint: string,
  peeringInfo?: { peerVpcId: string; peeringConnectionId: string }
): void => {
  console.log(chalk.blue.bold('\n🎉 Deployment Complete!\n'));
  console.log(chalk.green('Your observability stack is now running at:'));
  console.log(chalk.cyan.bold(`• Grafana (HTTPS): ${httpsEndpoint}`));

  if (peeringInfo) {
    console.log(chalk.blue.bold('\n🔗 VPC Peering Information:'));
    console.log(chalk.green(`• Peer VPC ID: ${peeringInfo.peerVpcId}`));
    console.log(
      chalk.green(`• Peering Connection ID: ${peeringInfo.peeringConnectionId}`)
    );
    console.log(
      chalk.yellow(
        '• Services are accessible from the peer VPC via private IPs'
      )
    );
  }

  console.log(chalk.yellow.bold('\n⚠️  Important Security Notice:'));
  console.log(chalk.yellow('This deployment uses a self-signed certificate.'));
  console.log(
    chalk.yellow(
      'Your browser will show security warnings that you need to accept.'
    )
  );
  console.log(
    chalk.yellow('This is normal and expected for self-signed certificates.\n')
  );

  console.log(chalk.blue('\n📋 Next Steps:'));
  console.log(
    chalk.white('1. Open the Grafana UI:'),
    chalk.green(httpsEndpoint)
  );
  console.log(
    chalk.white(
      '2. Accept the security warning for the self-signed certificate'
    )
  );
  console.log(chalk.white('3. Log in to Grafana'));
  console.log(chalk.white('   username:'), chalk.green('admin'));
  console.log(chalk.white('   password:'), chalk.green('admin'));

  if (peeringInfo) {
    console.log(chalk.blue('\n🔧 VPC Peering Setup:'));
    console.log(
      chalk.white('4. The VPC peering connection has been created and accepted')
    );
    console.log(chalk.white('5. Routes have been configured in the new VPC'));
    console.log(
      chalk.yellow(
        '6. ⚠️  MANUAL STEP REQUIRED: Add return routes in the peer VPC'
      )
    );
    console.log(
      chalk.cyan(
        `   Add route: Destination: 10.1.0.0/16, Target: ${peeringInfo.peeringConnectionId}`
      )
    );
    console.log(
      chalk.gray(
        '   (This needs to be done in each route table in the peer VPC)'
      )
    );
  }
};

const deployBackend = async () => {
  try {
    console.log(
      chalk.blue.bold('\n🚀 Observability Stack - Secure HTTPS Deployment\n')
    );

    // Check for .env file and peer VPC configuration (mandatory)
    const { hasEnv, peerVpcId } = checkEnvFile();

    if (!hasEnv) {
      console.log(chalk.red('❌ .env file not found.'));
      console.log(
        chalk.yellow('Please create a .env file with PEER_VPC_ID=vpc-xxxxxxxxx')
      );
      process.exit(1);
    }

    if (!peerVpcId) {
      console.log(chalk.red('❌ PEER_VPC_ID not found in .env file'));
      console.log(
        chalk.yellow('Please add PEER_VPC_ID=vpc-xxxxxxxxx to your .env file')
      );
      process.exit(1);
    }

    console.log(chalk.blue(`🔗 VPC Peering configured: ${peerVpcId}`));

    // Validate peer VPC exists
    const region =
      process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
    const isValidPeerVpc = await validatePeerVpc(peerVpcId, region);

    if (!isValidPeerVpc) {
      console.log(
        chalk.red(`❌ Invalid or inaccessible peer VPC: ${peerVpcId}`)
      );
      process.exit(1);
    }

    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: `This will deploy a secure observability stack with VPC peering to ${peerVpcId}. Continue?`,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      console.log(chalk.yellow('Deployment cancelled'));
      return;
    }

    if (!hasCredentials()) {
      console.log(chalk.yellow('AWS credentials not found. Starting init...'));
      await init();
    }

    console.log(
      chalk.green('✅ Using AWS credentials for:'),
      process.env.AWS_ACCESS_KEY_ID?.substring(0, 8) + '...'
    );

    console.log(chalk.yellow('\n📋 Generating CDK templates...'));
    const synthSpinner = ora('Running CDK Synth...').start();
    try {
      await execAsync('npx cdk synth');
      synthSpinner.succeed('CDK templates successfully created');
    } catch (error) {
      synthSpinner.fail('CDK Synth failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    console.log(chalk.yellow('\n🥾 Bootstrapping CDK (if needed)...'));
    const bootstrapSpinner = ora('Running CDK bootstrap...').start();
    try {
      await execAsync('npx cdk bootstrap');
      bootstrapSpinner.succeed('CDK bootstrapped successfully');
    } catch (error) {
      bootstrapSpinner.fail('CDK bootstrap failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    // Acknowledge notice
    try {
      await execAsync('npx cdk acknowledge 34892');
    } catch (error) {
      // Notice might not exist, continue
    }

    console.log(chalk.yellow('\n☁️  Deploying secure infrastructure...'));
    const deploySpinner = ora(
      'Deploying VPC, NAT Gateway, VPC Peering, and EC2 instance...'
    ).start();
    try {
      const { stderr } = await execAsync(
        'npx cdk deploy --require-approval never --outputs-file outputs.json'
      );
      deploySpinner.succeed('Infrastructure deployed successfully');

      if (stderr && !stderr.includes('npm WARN')) {
        console.log(chalk.gray(stderr));
      }
    } catch (error) {
      deploySpinner.fail('Infrastructure deployment failed');
      console.error(chalk.red(error));
      process.exit(1);
    }

    // Get deployment outputs
    const outputs = await getStackOutputs();

    if (!outputs.instanceId || !outputs.publicIp || !outputs.httpsEndpoint) {
      console.log(
        chalk.yellow('\n⚠️  Could not automatically retrieve instance details.')
      );
      const { instanceId, publicIp } = await inquirer.prompt([
        {
          type: 'input',
          name: 'instanceId',
          message: 'Enter the EC2 instance ID:',
          validate: (input) =>
            input.trim().length > 0 || 'Instance ID is required',
        },
        {
          type: 'input',
          name: 'publicIp',
          message: 'Enter the public IP address:',
          validate: (input) =>
            /^\d+\.\d+\.\d+\.\d+$/.test(input) || 'Valid IP address required',
        },
      ]);

      outputs.instanceId = instanceId;
      outputs.publicIp = publicIp;
      outputs.httpsEndpoint = `https://ec2-${publicIp.replace(/\./g, '-')}.${
        process.env.AWS_REGION
      }.compute.amazonaws.com`;
    }

    // Accept VPC peering connection if it exists
    if (outputs.peeringConnectionId) {
      const region =
        process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
      await acceptPeeringConnection(outputs.peeringConnectionId, region);
    }

    // Wait for instance to be ready
    if (outputs.instanceId) {
      await waitForInstanceReady(
        outputs.instanceId,
        process.env.AWS_REGION as string
      );
    }

    // Wait for HTTPS endpoint to be ready
    if (outputs.httpsEndpoint) {
      await waitForHTTPSReady(outputs.httpsEndpoint);
    }

    // Show service information
    if (outputs.httpsEndpoint && outputs.publicIp) {
      // VPC peering is now mandatory, so always include peering info
      const peeringInfo =
        outputs.peerVpcId && outputs.peeringConnectionId
          ? {
              peerVpcId: outputs.peerVpcId,
              peeringConnectionId: outputs.peeringConnectionId,
            }
          : undefined;

      showServiceInfo(outputs.httpsEndpoint, peeringInfo);
    } else {
      console.log(chalk.green('\n✅ Infrastructure deployed successfully!'));
      console.log(
        chalk.yellow('Check your AWS console for the instance details.')
      );
    }
  } catch (err) {
    console.error(chalk.red('\n❌ An error occurred:'), err);
    process.exit(1);
  }
};

export default deployBackend;
