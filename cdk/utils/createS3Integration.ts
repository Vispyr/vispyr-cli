import { Stack, RemovalPolicy } from 'aws-cdk-lib';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
} from 'aws-cdk-lib/aws-s3';
import { Role, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface S3IntegrationResult {
  bucket: Bucket;
  bucketName: string;
  region: string;
}

const createS3Integration = (
  scope: Construct,
  instanceRole: Role
): S3IntegrationResult => {
  const stack = Stack.of(scope);

  const bucket = new Bucket(scope, 'TempoTracesBucket', {
    bucketName: `vispyr-tempo-traces-${stack.stackName.toLowerCase()}-${
      stack.account
    }-${Math.random().toString(36).substring(2, 8)}`,
    encryption: BucketEncryption.S3_MANAGED,
    publicReadAccess: false,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });

  const s3PolicyStatement = new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      's3:PutObject',
      's3:GetObject',
      's3:ListBucket',
      's3:DeleteObject',
      's3:GetObjectTagging',
      's3:PutObjectTagging',
    ],
    resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
  });

  instanceRole.addToPolicy(s3PolicyStatement);

  return {
    bucket,
    bucketName: bucket.bucketName,
    region: stack.region,
  };
};

export default createS3Integration;
