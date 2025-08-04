import {
  DeleteRouteCommand,
  DescribeRouteTablesCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import ora from 'ora';
import { p, sleep } from '../shared.js';
import { Region } from '../../types.js';

const cleanupVpcPeeringRoutes = async (peeringConnectionId: string) => {
  try {
    if (process.env.PEER_VPC_ID && peeringConnectionId) {
      await cleanupRoutes(
        process.env.PEER_VPC_ID as string,
        peeringConnectionId,
        process.env.AWS_REGION as Region
      );
    } else {
      p(chalk.gray('No VPC peering connection details found'));
    }
  } catch (error) {
    p(
      chalk.yellow(
        'Could not determine parameters for VPC peering cleanup - continuing with teardown'
      )
    );
  }
};

const cleanupRoutes = async (
  peerVpcId: string,
  peeringConnectionId: string,
  region: Region
): Promise<void> => {
  const routeSpinner = ora('Cleaning up VPC peering routes...').start();
  await sleep(1000);

  try {
    const ec2 = new EC2Client({ region });

    const { RouteTables } = await ec2.send(
      new DescribeRouteTablesCommand({
        Filters: [
          {
            Name: 'vpc-id',
            Values: [peerVpcId],
          },
        ],
      })
    );

    if (!RouteTables || RouteTables.length === 0) {
      routeSpinner.warn('No route tables found in peer VPC');
      return;
    }

    let routesRemoved = 0;
    let routeTablesProcessed = 0;

    for (const routeTable of RouteTables) {
      if (!routeTable.RouteTableId || !routeTable.Routes) {
        continue;
      }

      routeTablesProcessed++;

      const peeringRoutes = routeTable.Routes.filter(
        (route) => route.VpcPeeringConnectionId === peeringConnectionId
      );

      for (const route of peeringRoutes) {
        if (!route.DestinationCidrBlock) {
          continue;
        }

        try {
          await ec2.send(
            new DeleteRouteCommand({
              RouteTableId: routeTable.RouteTableId,
              DestinationCidrBlock: route.DestinationCidrBlock,
            })
          );

          routesRemoved++;
          routeSpinner.text = `Removed route ${route.DestinationCidrBlock} from route table ${routeTable.RouteTableId}`;
        } catch (routeError) {
          p(
            chalk.yellow(
              `Warning: Could not remove route ${route.DestinationCidrBlock} from ${routeTable.RouteTableId}: ${routeError}`
            )
          );
        }
      }
    }

    if (routesRemoved > 0) {
      routeSpinner.succeed(
        `Removed ${routesRemoved} peering routes from ${routeTablesProcessed} route tables`
      );
    } else {
      routeSpinner.succeed('No peering routes found to remove');
    }
  } catch (error) {
    routeSpinner.warn(
      'Could not clean up VPC peering routes - continuing with teardown'
    );
    p(chalk.yellow(`VPC peering route cleanup warning: ${error}`));
  }
};

export default cleanupVpcPeeringRoutes;
