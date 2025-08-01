import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import inquirer from 'inquirer';
import ora from 'ora';
import path from 'path';
import { promisify } from 'util';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import {
  EC2Client,
  DescribeAddressesCommand,
  ReleaseAddressCommand,
  DescribeRouteTablesCommand,
  DeleteRouteCommand,
} from '@aws-sdk/client-ec2';
import fs from 'fs-extra';
import destroyCdkToolkit from '../utils/destroyCdkToolkit.js';
import { styleLog } from '../utils/deployTools.js';

const execAsync = promisify(exec);

const TITLE = 'blue bold';
const SUCCESS = 'green';
// const ERROR = 'red';
const INFO = 'yellow';
// const PROMPT = 'blue';

const cleanupVpcPeeringRoutes = async (
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

const destroyBackend = async () => {
  try {
    styleLog(TITLE, '\nVispyr Backend - Complete Teardown\n');

    const { confirmTeardown } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmTeardown',
        message:
          'This will delete the Vispyr EC2 instance, VPC, NAT Gateway, Elastic IP, CDKToolkit stack, and bootstrap S3 bucket. Continue?',
        default: false,
      },
    ]);

    if (!confirmTeardown) {
      console.log(chalk.yellow('Teardown cancelled'));
      return;
    }

    await execAsync('npx cdk acknowledge 34892');

    const eipSpinner = ora('Checking for Elastic IPs...').start();
    try {
      const ec2 = new EC2Client({ region: process.env.AWS_REGION });
      const { Addresses } = await ec2.send(new DescribeAddressesCommand({}));

      const unattachedEIPs = Addresses?.filter(
        (addr) => !addr.InstanceId && addr.AllocationId
      );

      if (unattachedEIPs && unattachedEIPs.length > 0) {
        eipSpinner.text = `Found ${unattachedEIPs.length} unattached Elastic IP(s), will clean up after stack destruction...`;
      }
      eipSpinner.succeed('Elastic IP check complete');
    } catch (error) {
      eipSpinner.warn(
        'Could not check Elastic IPs - continuing with stack destruction'
      );
    }

    try {
      const outputsPath = path.resolve(process.cwd(), 'outputs.json');

      if (fs.existsSync(outputsPath)) {
        const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
        const stackName = Object.keys(outputs)[0];
        const stackOutputs = outputs[stackName];

        if (process.env.PEER_VPC_ID && stackOutputs.PeeringConnectionId) {
          await cleanupVpcPeeringRoutes(
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
          chalk.gray(
            'No outputs.json found - skipping VPC peering route cleanup'
          )
        );
      }
    } catch (error) {
      console.log(
        chalk.yellow(
          'Could not read outputs for VPC peering cleanup - continuing with teardown'
        )
      );
    }

    styleLog(INFO, '\nDestroying Vispyr stack...');
    try {
      const cdkDestroy = spawn(
        'npx',
        ['cdk', 'destroy', 'VispyrStack', '--force'],
        {
          stdio: 'inherit',
          env: { ...process.env },
        }
      );

      await new Promise<void>((res, rej) => {
        cdkDestroy.on('close', (code) => {
          if (code === 0) {
            styleLog(SUCCESS, 'Vispyr stack destroyed successfully');
            res();
          } else {
            rej(new Error(`CDK destroy failed with code ${code}`));
          }
        });
      });
    } catch (error) {
      console.error(chalk.red('Failed to destroy Vispyr stack:'), error);
      // Continue with other cleanup even if stack destruction fails
    }

    const eipCleanupSpinner = ora(
      'Cleaning up any remaining Elastic IPs...'
    ).start();
    try {
      const ec2 = new EC2Client({ region: process.env.AWS_REGION });
      const { Addresses } = await ec2.send(new DescribeAddressesCommand({}));

      const unattachedEIPs = Addresses?.filter(
        (addr) => !addr.InstanceId && addr.AllocationId
      );

      if (unattachedEIPs && unattachedEIPs.length > 0) {
        for (const eip of unattachedEIPs) {
          if (eip.AllocationId) {
            await ec2.send(
              new ReleaseAddressCommand({ AllocationId: eip.AllocationId })
            );
            eipCleanupSpinner.text = `Released Elastic IP: ${eip.PublicIp}`;
          }
        }
        eipCleanupSpinner.succeed(
          `Released ${unattachedEIPs.length} Elastic IP(s)`
        );
      } else {
        eipCleanupSpinner.succeed('No unattached Elastic IPs found');
      }
    } catch (error) {
      eipCleanupSpinner.warn(
        'Could not clean up Elastic IPs - check AWS console manually'
      );
    }

    styleLog(INFO, '\nDestroying CDKToolkit...');
    try {
      await destroyCdkToolkit(process.env.AWS_REGION as string);
    } catch (error) {
      console.error(chalk.red(error));
    }

    const bucketSpinner = ora(
      'Searching for CDK bootstrap S3 bucket...'
    ).start();

    const s3 = new S3Client({});

    const { Buckets } = await s3.send(new ListBucketsCommand({}));

    const bootstrapBucket = Buckets?.find((b) => b.Name?.startsWith('cdk-'));

    if (!bootstrapBucket?.Name) {
      bucketSpinner.warn('No CDK bootstrap bucket found');
    } else {
      bucketSpinner.text = `Emptying bucket ${bootstrapBucket.Name}...`;

      const emptyBucket = async (bucketName: string): Promise<void> => {
        let isTruncated: boolean = true;
        let keyMarker: string | undefined;
        let versionIdMarker: string | undefined;

        while (isTruncated) {
          const listParams = {
            Bucket: bucketName,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          };

          const listedVersions = await s3.send(
            new ListObjectVersionsCommand(listParams)
          );

          if (!listedVersions.Versions && !listedVersions.DeleteMarkers) {
            break;
          }

          const objectsToDelete: Array<{ Key: string; VersionId: string }> = [];

          if (listedVersions.Versions) {
            listedVersions.Versions.forEach((version) => {
              if (version.Key && version.VersionId) {
                objectsToDelete.push({
                  Key: version.Key,
                  VersionId: version.VersionId,
                });
              }
            });
          }

          if (listedVersions.DeleteMarkers) {
            listedVersions.DeleteMarkers.forEach((marker) => {
              if (marker.Key && marker.VersionId) {
                objectsToDelete.push({
                  Key: marker.Key,
                  VersionId: marker.VersionId,
                });
              }
            });
          }

          if (objectsToDelete.length > 0) {
            const batchSize: number = 1000;
            for (let i = 0; i < objectsToDelete.length; i += batchSize) {
              const batch = objectsToDelete.slice(i, i + batchSize);
              await s3.send(
                new DeleteObjectsCommand({
                  Bucket: bucketName,
                  Delete: {
                    Objects: batch,
                    Quiet: true,
                  },
                })
              );
            }
          }

          isTruncated = listedVersions.IsTruncated || false;
          keyMarker = listedVersions.NextKeyMarker;
          versionIdMarker = listedVersions.NextVersionIdMarker;
        }
      };

      await emptyBucket(bootstrapBucket.Name);

      bucketSpinner.text = `Deleting bucket ${bootstrapBucket.Name}...`;
      await s3.send(new DeleteBucketCommand({ Bucket: bootstrapBucket.Name }));

      bucketSpinner.succeed(`Bucket ${bootstrapBucket.Name} deleted`);
    }

    const cleanupSpinner = ora('Cleaning up local files...').start();
    try {
      if (fs.existsSync('cdk.out')) fs.removeSync('cdk.out');
      if (fs.existsSync('cdk.context.json')) fs.removeSync('cdk.context.json');
      if (fs.existsSync('outputs.json')) fs.removeSync('outputs.json');
      if (fs.existsSync('.aws')) fs.removeSync('.aws');

      cleanupSpinner.succeed('Local files cleaned up');
    } catch (error) {
      cleanupSpinner.warn('Some local files could not be cleaned up');
    }

    console.log(chalk.green.bold('\nComplete teardown finished!'));
  } catch (err) {
    console.error(chalk.red('\nAn error occurred during teardown:'), err);
    console.log(
      chalk.yellow(
        '\nPlease check your AWS console to manually clean up any remaining resources.'
      )
    );
    process.exit(1);
  }
};

export default destroyBackend;
