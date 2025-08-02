import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import init from './init.js';
import { hasCredentials } from '../utils/config.js';

import { acknowledgeNotice, p } from '../utils/shared.js';
import { getPeerVpcId } from '../utils/deploy_tools/envService.js';
import validatePeerVpc from '../utils/deploy_tools/validatePeerVpc.js';
import generateNonOverlappingCidr from '../utils/deploy_tools/generateNonOverlappingCidr.js';
import getSubnetsWithRouteTables from '../utils/deploy_tools/getSubnetsWithRouteTables.js';
import writeConfigAlloy from '../utils/deploy_tools/configAlloy.js';
import teardownInfrastructure from '../utils/deploy_tools/teardownInfrastructure.js';
import acceptPeeringConnection from '../utils/deploy_tools/acceptPeeringConnection.js';
import waitForInstanceReady from '../utils/deploy_tools/waitforInstanceReady.js';
import waitForHTTPSReady from '../utils/deploy_tools/waitForHTTPSReady.js';
import showServiceInfo from '../utils/deploy_tools/showServiceInfo.js';
import {
  addRouteToSubnet,
  cleanupAddedRoutes,
} from '../utils/deploy_tools/routingService.js';
import {
  bootstrap,
  deployInfrastructure,
} from '../utils/deploy_tools/cdkDeploy.js';
import {
  getStackOutputs,
  promptInstanceData,
} from '../utils/deploy_tools/outputService.js';

const execAsync = promisify(exec);

const deployBackend = async () => {
  try {
    p(chalk.blue.bold('\nVispyr Backend - Secure HTTPS Deployment\n'));

    const peerVpcId = getPeerVpcId();

    const region = process.env.AWS_REGION as string;
    const peerVpcValidation = await validatePeerVpc(peerVpcId, region);

    if (!peerVpcValidation.isValid || !peerVpcValidation.cidrBlock) {
      p(chalk.red(`Invalid or inaccessible peer VPC: ${peerVpcId}`));
      process.exit(1);
    }

    const newVpcCidr = generateNonOverlappingCidr(peerVpcValidation.cidrBlock);
    const subnets = await getSubnetsWithRouteTables(peerVpcId, region);

    if (subnets.length === 0) {
      p(chalk.red('No subnets found in peer VPC'));
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

    p(
      chalk.green(
        `Selected: ${selectedSubnet.name} (Route Table: ${selectedSubnet.routeTableId})`
      )
    );

    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: `This will deploy a the Vispyr Backend stack with VPC peering to ${peerVpcId} and automatically configure return routes.\n  Continue?`,
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      p(chalk.yellow('Deployment cancelled'));
      return;
    }

    if (!hasCredentials()) {
      p(chalk.yellow('AWS credentials not found. Starting init...'));
      await init();
    }

    p(chalk.yellow('\nGenerating CDK templates...'));
    const synthSpinner = ora('Running CDK Synth...').start();
    try {
      await execAsync('npx cdk synth');
      synthSpinner.succeed('CDK templates successfully created');
    } catch (error) {
      synthSpinner.fail('CDK Synth failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    await bootstrap();
    await acknowledgeNotice(34892);
    await deployInfrastructure();

    const outputs = await getStackOutputs();

    if (!outputs.instanceId || !outputs.publicIp || !outputs.httpsEndpoint) {
      await promptInstanceData(outputs);
    }

    if (outputs.privateIp) {
      try {
        await writeConfigAlloy(outputs.privateIp);
      } catch (error) {
        console.error(chalk.red('Failed to create config.alloy file:'), error);
        p(
          chalk.yellow(
            'Cleaning up infrastructure due to config.alloy failure...'
          )
        );
        await cleanupAddedRoutes(region);
        await teardownInfrastructure();
        process.exit(1);
      }
    } else {
      console.error(chalk.red('Private IP not found in deployment outputs'));
      p(
        chalk.yellow('Cleaning up infrastructure due to missing private IP...')
      );
      await cleanupAddedRoutes(region);
      await teardownInfrastructure();
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
      p(chalk.green('\nInfrastructure deployed successfully!'));
      p(chalk.yellow('Check your AWS console for the instance details.'));
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
