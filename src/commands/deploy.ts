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
  styleLog,
  showServiceInfo,
  tearDownInfrastructure,
  validatePeerVpc,
  waitForHTTPSReady,
  waitForInstanceReady,
  writeConfigAlloy,
} from '../utils/deployTools.js';

const execAsync = promisify(exec);

const TITLE = 'blue bold';
const SUCCESS = 'green';
const ERROR = 'red';
const INFO = 'yellow';
const PROMPT = 'blue';

const deployBackend = async () => {
  try {
    styleLog(TITLE, '\nObservability Stack - Secure HTTPS Deployment\n');

    const { hasEnv, peerVpcId } = checkEnvFile();

    if (!hasEnv) {
      styleLog(ERROR, '.env file not found.');
      styleLog(
        INFO,
        'Please create a .env file with PEER_VPC_ID=vpc-xxxxxxxxx'
      );
      process.exit(1);
    }

    if (!peerVpcId) {
      styleLog(ERROR, 'PEER_VPC_ID not found in .env file');
      styleLog(INFO, 'Please add PEER_VPC_ID=vpc-xxxxxxxxx to your .env file');
      process.exit(1);
    }

    styleLog(PROMPT, `VPC Peering configured: ${peerVpcId}`);

    const region =
      process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
    const peerVpcValidation = await validatePeerVpc(peerVpcId, region);

    if (!peerVpcValidation.isValid || !peerVpcValidation.cidrBlock) {
      styleLog(ERROR, `Invalid or inaccessible peer VPC: ${peerVpcId}`);
      process.exit(1);
    }

    const newVpcCidr = generateNonOverlappingCidr(peerVpcValidation.cidrBlock);
    styleLog(PROMPT, `New VPC will use CIDR: ${newVpcCidr}`);

    styleLog(PROMPT, '\nRetrieving peer VPC subnet information...');
    const subnets = await getSubnetsWithRouteTables(peerVpcId, region);

    if (subnets.length === 0) {
      styleLog(ERROR, 'No subnets found in peer VPC');
      process.exit(1);
    }

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

    styleLog(
      SUCCESS,
      `Selected: ${selectedSubnet.name} (Route Table: ${selectedSubnet.routeTableId})`
    );

    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: `This will deploy a secure observability stack with VPC peering to ${peerVpcId} and automatically configure return routes.\n  Continue?`,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      styleLog(INFO, 'Deployment cancelled');
      return;
    }

    if (!hasCredentials()) {
      styleLog(INFO, 'AWS credentials not found. Starting init...');
      await init();
    }

    console.log(
      chalk.green('Using AWS credentials for:'),
      process.env.AWS_ACCESS_KEY_ID?.substring(0, 8) + '...'
    );

    styleLog(INFO, '\nGenerating CDK templates...');
    const synthSpinner = ora('Running CDK Synth...').start();
    try {
      await execAsync('npx cdk synth');
      synthSpinner.succeed('CDK templates successfully created');
    } catch (error) {
      synthSpinner.fail('CDK Synth failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    styleLog(INFO, '\nBootstrapping CDK (if needed)...');
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

    styleLog(INFO, '\nDeploying secure infrastructure...');
    const deploySpinner = ora(
      'Deploying VPC, NAT Gateway, VPC Peering, and EC2 instance...'
    ).start();
    try {
      const { stderr } = await execAsync(
        'npx cdk deploy --quiet --require-approval never --outputs-file outputs.json > /dev/null'
      );
      deploySpinner.succeed('Infrastructure deployed successfully');

      if (
        stderr &&
        !stderr.includes('npm WARN') &&
        !stderr.includes('[WARNING]')
      ) {
        styleLog('gray', stderr);
      }
    } catch (error) {
      deploySpinner.fail('Infrastructure deployment failed');
      console.error(chalk.red(error));
      process.exit(1);
    }

    const outputs = await getStackOutputs();

    if (!outputs.instanceId || !outputs.publicIp || !outputs.httpsEndpoint) {
      styleLog(INFO, '\nCould not automatically retrieve instance details.');
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

    if (outputs.privateIp) {
      try {
        await writeConfigAlloy(outputs.privateIp);
      } catch (error) {
        console.error(chalk.red('Failed to create config.alloy file:'), error);
        console.log(
          chalk.yellow(
            'Cleaning up infrastructure due to config.alloy failure...'
          )
        );
        await cleanupAddedRoutes(region);
        await tearDownInfrastructure();
        process.exit(1);
      }
    } else {
      console.error(chalk.red('Private IP not found in deployment outputs'));
      console.log(
        chalk.yellow('Cleaning up infrastructure due to missing private IP...')
      );
      await cleanupAddedRoutes(region);
      await tearDownInfrastructure();
      process.exit(1);
    }

    if (outputs.peeringConnectionId) {
      await acceptPeeringConnection(outputs.peeringConnectionId, region);

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

    if (outputs.instanceId) {
      await waitForInstanceReady(
        outputs.instanceId,
        process.env.AWS_REGION as string
      );
    }

    if (outputs.httpsEndpoint) {
      await waitForHTTPSReady(outputs.httpsEndpoint);
    }

    if (outputs.httpsEndpoint && outputs.publicIp) {
      showServiceInfo(outputs.httpsEndpoint);
    } else {
      console.log(chalk.green('\nInfrastructure deployed successfully!'));
      console.log(
        chalk.yellow('Check your AWS console for the instance details.')
      );
    }
  } catch (err) {
    console.error(chalk.red('\nAn error occurred:'), err);

    const region =
      process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
    await cleanupAddedRoutes(region);

    process.exit(1);
  }
};

export default deployBackend;
