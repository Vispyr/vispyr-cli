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
import fs from 'fs-extra';
import destroyCdkToolkit from '../utils/destroyCdkToolkit';
fs.removeSync('cdk.out');

const execAsync = promisify(exec);

const destroy = async () => {
  try {
    console.log(chalk.blue.bold('\nObservability Stack - Teardown\n'));

    const { confirmTeardown } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmTeardown',
        message:
          'This will delete the EC2 instance, CDKToolkit stack, and the bootstrap S3 bucket. Continue?',
        default: false,
      },
    ]);

    if (!confirmTeardown) {
      console.log(chalk.yellow('Teardown cancelled'));
      return;
    }

    // Acknowledge notice
    await execAsync('npx cdk acknowledge 34892');

    // 1. Destroy Ec2Stack
    const destroySpinner = ora(
      'Destroying deployed stack (Ec2Stack)...'
    ).start();
    try {
      const { stdout, stderr } = await execAsync(
        'npx cdk destroy Ec2Stack --force'
      );
      destroySpinner.succeed('Ec2Stack destroyed successfully');
      console.log(stdout);
      if (stderr) console.error(chalk.gray(stderr));
    } catch (error) {
      destroySpinner.fail('Failed to destroy Ec2Stack');
      console.error(chalk.red(error));
    }

    // 2. Destroy CDKToolkit
    // From Google, check if it works
    const toolkitSpinner = ora('Destroying CDKToolkit stack...').start();
    try {
      destroyCdkToolkit(process.env.AWS_REGION as string);

      toolkitSpinner.succeed('CDKToolkit destroyed successfully');
    } catch (error) {
      toolkitSpinner.fail('Failed to destroy CDKToolkit');
      console.error(chalk.red(error));
    }

    // 3. Remove CDK Bootstrap S3 Bucket
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

      // Local File Cleanup
      fs.removeSync('cdk.out');
      fs.removeSync('.aws'); // no longer need
      fs.removeSync('cdk.context.json');
    }
  } catch (err) {
    console.error(chalk.red('An error occurred during teardown:'), err);
    process.exit(1);
  }
};

export default destroy;
