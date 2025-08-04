import {
  CreateRouteCommand,
  DeleteRouteCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import ora from 'ora';

import { p, sleep } from '../shared.js';
import { Region } from '../../types.js';

interface AddedRoute {
  routeTableId: string;
  destinationCidr: string;
  peeringConnectionId: string;
}

let addedRoutes: AddedRoute[] = [];

export const addRouteToSubnet = async (
  routeTableId: string,
  destinationCidr: string,
  peeringConnectionId: string,
  region: Region
): Promise<void> => {
  try {
    const ec2Client = new EC2Client({ region });
    const spinner = ora(
      `Adding route to route table ${routeTableId}...`
    ).start();
    await sleep(1000);

    await ec2Client.send(
      new CreateRouteCommand({
        RouteTableId: routeTableId,
        DestinationCidrBlock: destinationCidr,
        VpcPeeringConnectionId: peeringConnectionId,
      })
    );

    addedRoutes.push({
      routeTableId,
      destinationCidr,
      peeringConnectionId,
    });

    spinner.succeed(`Route added: ${destinationCidr} → ${peeringConnectionId}`);
  } catch (error) {
    console.error(chalk.red('Failed to add route:'), error);
    throw error;
  }
};

export const cleanupAddedRoutes = async (region: Region): Promise<void> => {
  if (addedRoutes.length === 0) return;

  p(chalk.yellow('\n🧹 Cleaning up added routes...'));
  const ec2Client = new EC2Client({ region });

  for (const route of addedRoutes) {
    try {
      const spinner = ora(
        `Removing route from ${route.routeTableId}...`
      ).start();

      await ec2Client.send(
        new DeleteRouteCommand({
          RouteTableId: route.routeTableId,
          DestinationCidrBlock: route.destinationCidr,
        })
      );

      spinner.succeed(`Route removed from ${route.routeTableId}`);
    } catch (error) {
      console.warn(
        chalk.yellow(`Failed to cleanup route in ${route.routeTableId}:`),
        error
      );
    }
  }

  addedRoutes = [];
};
