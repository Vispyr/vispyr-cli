import chalk from 'chalk';
import { Region, SubnetInfo } from '../../types.js';
import { VispyrDeploymentParams } from '../ssmService.js';
import acceptPeeringConnection from './acceptPeeringConnection.js';
import { addRouteToSubnet, cleanupAddedRoutes } from './routingService.js';
import waitForHTTPSReady from './waitForHTTPSReady.js';
import waitForInstanceReady from './waitforInstanceReady.js';

export const verifyConnection = async (
  params: VispyrDeploymentParams,
  region: Region,
  selectedSubnet: SubnetInfo,
  newVpcCidr: string
) => {
  if (params.peeringConnectionId) {
    await acceptPeeringConnection(params.peeringConnectionId, region);

    try {
      await addRouteToSubnet(
        selectedSubnet.routeTableId,
        newVpcCidr,
        params.peeringConnectionId,
        region
      );
    } catch (error) {
      console.error(chalk.red('Failed to add return route, cleaning up...'));
      await cleanupAddedRoutes(region);
      throw error;
    }
  }

  if (params.instanceId) {
    await waitForInstanceReady(params.instanceId, region as Region);
  }

  if (params.httpsEndpoint) {
    await waitForHTTPSReady(params.httpsEndpoint);
  }
};
