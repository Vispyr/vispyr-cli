import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import ora from 'ora';
import { sleep } from '../shared.js';

const destroyS3Bucket = async () => {
  const bucketSpinner = ora('Searching for CDK bootstrap S3 bucket...').start();
  await sleep(1000);

  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error('AWS_REGION environment variable is not set');
  }

  const s3 = new S3Client({ region });

  const { Buckets } = await s3.send(new ListBucketsCommand({}));

  const bootstrapBucket = Buckets?.find(
    (b) => b.Name?.startsWith('cdk-') && b.Name?.endsWith(`-${region}`)
  );

  if (!bootstrapBucket?.Name) {
    bucketSpinner.warn(`No CDK bootstrap bucket found for region ${region}`);
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
};

export default destroyS3Bucket;
