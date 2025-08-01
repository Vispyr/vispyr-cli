import {
  DeleteRouteCommand,
  DescribeRouteTablesCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs';

const cleanupVpcPeeringRoutes = async () => {
  try {
    const outputsPath = path.resolve(process.cwd(), 'outputs.json');

    if (fs.existsSync(outputsPath)) {
      const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
      const stackName = Object.keys(outputs)[0];
      const stackOutputs = outputs[stackName];

      if (process.env.PEER_VPC_ID && stackOutputs.PeeringConnectionId) {
        await cleanupRoutes(
          process.env.PEER_VPC_ID as string,
          stackOutputs.PeeringConnectionId,
          process.env.AWS_REGION as string
        );
      } else {
        console.log(
          chalk.gray('No VPC peering connection details found in outputs')
        );
      }
    } else {
      console.log(
        chalk.gray('No outputs.json found - skipping VPC peering route cleanup')
      );
    }
  } catch (error) {
    console.log(
      chalk.yellow(
        'Could not read outputs for VPC peering cleanup - continuing with teardown'
      )
    );
  }
};

const cleanupRoutes = async (
  peerVpcId: string,
  peeringConnectionId: string,
  region: string
): Promise<void> => {
  const routeSpinner = ora('Cleaning up VPC peering routes...').start();

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
          console.log(
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
    console.log(chalk.yellow(`VPC peering route cleanup warning: ${error}`));
  }
};

export default cleanupVpcPeeringRoutes;
