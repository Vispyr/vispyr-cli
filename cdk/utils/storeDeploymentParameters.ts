import { Construct } from 'constructs';
import { Fn, Stack } from 'aws-cdk-lib';
import {
  Instance,
  CfnVPCPeeringConnection,
  CfnEIP,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { StringParameter, ParameterTier } from 'aws-cdk-lib/aws-ssm';

const storeDeploymentParameters = (
  scope: Construct,
  instance: Instance,
  peeringConnection: CfnVPCPeeringConnection,
  eip: CfnEIP,
  vpc: Vpc
): void => {
  const parameterPrefix = '/vispyr/backend';
  const stack = Stack.of(scope);

  new StringParameter(scope, 'InstanceIdParameter', {
    parameterName: `${parameterPrefix}/instance-id`,
    stringValue: instance.instanceId,
    description: 'Vispyr Backend EC2 Instance ID',
    tier: ParameterTier.STANDARD,
  });

  new StringParameter(scope, 'PublicIPParameter', {
    parameterName: `${parameterPrefix}/public-ip`,
    stringValue: eip.ref,
    description: 'Vispyr Backend Public IP Address',
    tier: ParameterTier.STANDARD,
  });

  new StringParameter(scope, 'PrivateIPParameter', {
    parameterName: `${parameterPrefix}/private-ip`,
    stringValue: instance.instancePrivateIp,
    description: 'Vispyr Backend Private IP Address',
    tier: ParameterTier.STANDARD,
  });

  const region = process.env.AWS_REGION || stack.region;
  const computeDomain =
    region === 'us-east-1'
      ? 'compute-1.amazonaws.com'
      : `${region}.compute.amazonaws.com`;

  const httpsEndpoint = Fn.sub('https://ec2-${EipWithDashes}.${Domain}', {
    EipWithDashes: Fn.join('-', Fn.split('.', eip.ref)),
    Domain: computeDomain,
  });

  new StringParameter(scope, 'HttpsEndpointParameter', {
    parameterName: `${parameterPrefix}/https-endpoint`,
    stringValue: httpsEndpoint,
    description: 'Vispyr Backend HTTPS Endpoint URL',
    tier: ParameterTier.STANDARD,
  });

  new StringParameter(scope, 'PeeringConnectionIdParameter', {
    parameterName: `${parameterPrefix}/peering-connection-id`,
    stringValue: peeringConnection.attrId,
    description: 'VPC Peering Connection ID',
    tier: ParameterTier.STANDARD,
  });

  new StringParameter(scope, 'VpcIdParameter', {
    parameterName: `${parameterPrefix}/vpc-id`,
    stringValue: vpc.vpcId,
    description: 'Vispyr Backend VPC ID',
    tier: ParameterTier.STANDARD,
  });

  new StringParameter(scope, 'DeploymentTimestampParameter', {
    parameterName: `${parameterPrefix}/deployment-timestamp`,
    stringValue: new Date().toISOString(),
    description: 'Timestamp of last deployment',
    tier: ParameterTier.STANDARD,
  });
};

export default storeDeploymentParameters;
