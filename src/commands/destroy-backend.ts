import chalk from 'chalk';
import { exec } from 'child_process';
import inquirer from 'inquirer';
import ora from 'ora';
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
} from '@aws-sdk/client-ec2';
import fs from 'fs-extra';
import destroyCdkToolkit from '../utils/destroyCdkToolkit.js';

const execAsync = promisify(exec);

const destroyBackend = async () => {
  try {
    console.log(
      chalk.blue.bold('\n🗑️  Observability Stack - Complete Teardown\n')
    );

    const { confirmTeardown } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmTeardown',
        message:
          'This will delete the EC2 instance, VPC, NAT Gateway, Elastic IP, CDKToolkit stack, and bootstrap S3 bucket. Continue?',
        default: false,
      },
    ]);

    if (!confirmTeardown) {
      console.log(chalk.yellow('Teardown cancelled'));
      return;
    }

    // Acknowledge notice (ignore if it doesn't exist)
    try {
      await execAsync('npx cdk acknowledge 34892');
    } catch (error) {
      // Notice might not exist, continue
    }

    // 1. Check for any unattached Elastic IPs before destroying stack
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

    // 2. Destroy Ec2Stack
    const destroySpinner = ora(
      'Destroying observability stack (VPC, EC2, NAT Gateway, etc.)...'
    ).start();
    try {
      const { stdout, stderr } = await execAsync(
        'npx cdk destroy Ec2Stack --force'
      );
      destroySpinner.succeed('Observability stack destroyed successfully');

      if (stdout) console.log(chalk.gray(stdout));
      if (stderr && !stderr.includes('npm WARN')) {
        console.log(chalk.gray(stderr));
      }
    } catch (error) {
      destroySpinner.fail('Failed to destroy observability stack');
      console.error(chalk.red(error));
      // Continue with other cleanup even if stack destruction fails
    }

    // 3. Clean up any remaining Elastic IPs (sometimes they don't get released automatically)
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

    // 4. Destroy CDKToolkit
    const toolkitSpinner = ora('Destroying CDKToolkit stack...').start();
    try {
      await destroyCdkToolkit(process.env.AWS_REGION as string);
      toolkitSpinner.succeed('CDKToolkit destroyed successfully');
    } catch (error) {
      toolkitSpinner.fail('Failed to destroy CDKToolkit');
      console.error(chalk.red(error));
    }

    // 5. Remove CDK Bootstrap S3 Bucket
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

      // Helper function to empty bucket completely (including all versions)
      const emptyBucket = async (bucketName: string): Promise<void> => {
        let isTruncated: boolean = true;
        let keyMarker: string | undefined;
        let versionIdMarker: string | undefined;

        while (isTruncated) {
          // List all object versions (current and non-current)
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

          // Add all versions to delete list
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

          // Add all delete markers to delete list
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

          // Delete objects in batches (AWS limit is 1000 per request)
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

      // Empty the bucket completely
      await emptyBucket(bootstrapBucket.Name);

      bucketSpinner.text = `Deleting bucket ${bootstrapBucket.Name}...`;
      await s3.send(new DeleteBucketCommand({ Bucket: bootstrapBucket.Name }));

      bucketSpinner.succeed(`Bucket ${bootstrapBucket.Name} deleted`);
    }

    // 6. Local File Cleanup
    const cleanupSpinner = ora('Cleaning up local files...').start();
    try {
      // Remove CDK generated files
      if (fs.existsSync('cdk.out')) fs.removeSync('cdk.out');
      if (fs.existsSync('cdk.context.json')) fs.removeSync('cdk.context.json');
      if (fs.existsSync('outputs.json')) fs.removeSync('outputs.json');
      if (fs.existsSync('.aws')) fs.removeSync('.aws');

      cleanupSpinner.succeed('Local files cleaned up');
    } catch (error) {
      cleanupSpinner.warn('Some local files could not be cleaned up');
    }

    console.log(chalk.green.bold('\n✅ Complete teardown finished!'));
    console.log(
      chalk.gray('All AWS resources and local files have been cleaned up.')
    );
    console.log(
      chalk.gray(
        'Please verify in your AWS console that all resources are deleted.\n'
      )
    );
  } catch (err) {
    console.error(chalk.red('\n❌ An error occurred during teardown:'), err);
    console.log(
      chalk.yellow(
        '\n⚠️  Please check your AWS console to manually clean up any remaining resources.'
      )
    );
    process.exit(1);
  }
};

export default destroyBackend;
