import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import init from './init.js';
import { hasCredentials } from '../utils/config.js';
import {
  acceptPeeringConnection,
  acknowledgeNotice,
  addRouteToSubnet,
  checkEnvFile,
  cleanupAddedRoutes,
  generateNonOverlappingCidr,
  getStackOutputs,
  getSubnetsWithRouteTables,
  logWithStyle,
  showServiceInfo,
  validatePeerVpc,
  waitForHTTPSReady,
  waitForInstanceReady,
} from '../utils/deployTools.js';

const TITLE = 'blue bold';
const SUCCESS = 'green';
const ERROR = 'red';
const INFO = 'yellow';
const PROMPT = 'blue';

const execAsync = promisify(exec);

const deployBackend = async () => {
  try {
    logWithStyle(TITLE, '\n🚀 Observability Stack - Secure HTTPS Deployment\n');

    // Check for .env file and peer VPC configuration (mandatory)
    const { hasEnv, peerVpcId } = checkEnvFile();

    if (!hasEnv) {
      logWithStyle(ERROR, '❌ .env file not found.');
      logWithStyle(
        INFO,
        'Please create a .env file with PEER_VPC_ID=vpc-xxxxxxxxx'
      );
      process.exit(1);
    }

    if (!peerVpcId) {
      logWithStyle(ERROR, '❌ PEER_VPC_ID not found in .env file');
      logWithStyle(
        INFO,
        'Please add PEER_VPC_ID=vpc-xxxxxxxxx to your .env file'
      );
      process.exit(1);
    }

    logWithStyle(PROMPT, `🔗 VPC Peering configured: ${peerVpcId}`);

    // Validate peer VPC exists and get its CIDR
    const region =
      process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
    const peerVpcValidation = await validatePeerVpc(peerVpcId, region);

    if (!peerVpcValidation.isValid || !peerVpcValidation.cidrBlock) {
      logWithStyle(ERROR, `❌ Invalid or inaccessible peer VPC: ${peerVpcId}`);
      process.exit(1);
    }

    // Generate non-overlapping CIDR for the new VPC
    const newVpcCidr = generateNonOverlappingCidr(peerVpcValidation.cidrBlock);
    logWithStyle(PROMPT, `📍 New VPC will use CIDR: ${newVpcCidr}`);

    // Get subnets in peer VPC for route table selection
    logWithStyle(PROMPT, '\n🔍 Retrieving peer VPC subnet information...');
    const subnets = await getSubnetsWithRouteTables(peerVpcId, region);

    if (subnets.length === 0) {
      logWithStyle(ERROR, '❌ No subnets found in peer VPC');
      process.exit(1);
    }

    // Let user select which subnet's route table to modify
    const subnetChoices = subnets.map((subnet) => ({
      name: `${subnet.name} (${subnet.subnetId} - ${subnet.cidr})`,
      value: subnet,
    }));

    const { selectedSubnet } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedSubnet',
        message: chalk.cyan(
          'Select the subnet whose route table should receive the return route:'
        ),
        choices: subnetChoices,
        pageSize: 15,
      },
    ]);

    logWithStyle(
      SUCCESS,
      `✅ Selected: ${selectedSubnet.name} (Route Table: ${selectedSubnet.routeTableId})`
    );

    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: `This will deploy a secure observability stack with VPC peering to ${peerVpcId} and automatically configure return routes. Continue?`,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      logWithStyle(INFO, 'Deployment cancelled');
      return;
    }

    if (!hasCredentials()) {
      logWithStyle(INFO, 'AWS credentials not found. Starting init...');
      await init();
    }

    console.log(
      logWithStyle(SUCCESS, '✅ Using AWS credentials for:'),
      process.env.AWS_ACCESS_KEY_ID?.substring(0, 8) + '...'
    );

    logWithStyle(INFO, '\n📋 Generating CDK templates...');
    const synthSpinner = ora('Running CDK Synth...').start();
    try {
      await execAsync('npx cdk synth');
      synthSpinner.succeed('CDK templates successfully created');
    } catch (error) {
      synthSpinner.fail('CDK Synth failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    logWithStyle(INFO, '\n🥾 Bootstrapping CDK (if needed)...');
    const bootstrapSpinner = ora('Running CDK bootstrap...').start();
    try {
      await execAsync('npx cdk bootstrap');
      bootstrapSpinner.succeed('CDK bootstrapped successfully');
    } catch (error) {
      bootstrapSpinner.fail('CDK bootstrap failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    await acknowledgeNotice(34892);

    logWithStyle(INFO, '\n☁️  Deploying secure infrastructure...');
    const deploySpinner = ora(
      'Deploying VPC, NAT Gateway, VPC Peering, and EC2 instance...'
    ).start();
    try {
      const { stderr } = await execAsync(
        'npx cdk deploy --require-approval never --outputs-file outputs.json'
      );
      deploySpinner.succeed('Infrastructure deployed successfully');

      if (stderr && !stderr.includes('npm WARN')) {
        logWithStyle('gray', stderr);
      }
    } catch (error) {
      deploySpinner.fail('Infrastructure deployment failed');
      console.error(chalk.red(error));
      process.exit(1);
    }

    const outputs = await getStackOutputs();

    if (!outputs.instanceId || !outputs.publicIp || !outputs.httpsEndpoint) {
      logWithStyle(
        INFO,
        '\n⚠️  Could not automatically retrieve instance details.'
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
      await acceptPeeringConnection(outputs.peeringConnectionId, region);

      // Add return route to the selected subnet's route table
      try {
        await addRouteToSubnet(
          selectedSubnet.routeTableId,
          newVpcCidr,
          outputs.peeringConnectionId,
          region
        );
      } catch (error) {
        console.error(chalk.red('Failed to add return route, cleaning up...'));
        await cleanupAddedRoutes(region);
        throw error;
      }
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
      logWithStyle(SUCCESS, '\n✅ Infrastructure deployed successfully!');
      logWithStyle(INFO, 'Check your AWS console for the instance details.');
    }
  } catch (err) {
    logWithStyle(ERROR, '\n❌ An error occurred:'), err;

    // Cleanup any routes we added before failing
    const region =
      process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
    await cleanupAddedRoutes(region);

    process.exit(1);
  }
};

export default deployBackend;
