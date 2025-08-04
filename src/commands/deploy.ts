import chalk from 'chalk';
import generateNonOverlappingCidr from '../utils/deploy_tools/generateNonOverlappingCidr.js';
import selectSubnet from '../utils/deploy_tools/subnetService.js';
import getPeerVpcId from '../utils/deploy_tools/peerVpcService.js';
import { validateCredentials } from '../utils/config.js';
import { acknowledgeNotice, p } from '../utils/shared.js';
import { Region } from '../types.js';
import { VispyrSSMManager } from '../utils/ssmService.js';
import confirmDeployment from '../utils/deploy_tools/confirmDeploy.js';
import { cleanupAddedRoutes } from '../utils/deploy_tools/routingService.js';
import generateConfigAlloy from '../utils/deploy_tools/alloyService.js';
import { verifyConnection } from '../utils/deploy_tools/connectionService.js';
import showBackendInfo from '../utils/deploy_tools/showBackendInfo.js';
import {
  bootstrap,
  deployInfrastructure,
  runCdkSynth,
} from '../utils/deploy_tools/cdkDeploy.js';

const deployBackend = async () => {
  try {
    p(chalk.blue.bold('\nVispyr Backend - Secure HTTPS Deployment\n'));

    await confirmDeployment();
    validateCredentials();

    const region = process.env.AWS_REGION as Region;
    const { peerVpcId, cidrBlock } = await getPeerVpcId(region);
    const newVpcCidr = generateNonOverlappingCidr(cidrBlock);
    const selectedSubnet = await selectSubnet(peerVpcId, region);

    await acknowledgeNotice();
    await runCdkSynth();
    await bootstrap();
    await deployInfrastructure();

    const ssmManager = new VispyrSSMManager();
    const params = await ssmManager.getDeploymentParameters();

    generateConfigAlloy(params.privateIp, region);
    await verifyConnection(params, region, selectedSubnet, newVpcCidr);

    showBackendInfo(params.httpsEndpoint, params.publicIp);
  } catch (err) {
    console.error(chalk.red('\nAn error occurred:'), err);

    const region = process.env.AWS_REGION as Region;
    await cleanupAddedRoutes(region);

    process.exit(1);
  }
};

export default deployBackend;
