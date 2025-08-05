import { Construct } from 'constructs';
import {
  Vpc,
  CfnVPCPeeringConnection,
  IVpc,
  IpAddresses,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';

interface VpcSetupResult {
  vpc: Vpc;
  peerVpc: IVpc;
  peeringConnection: CfnVPCPeeringConnection;
}

const createVpcWithPeering = (
  scope: Construct,
  peerVpcId: string
): VpcSetupResult => {
  if (!peerVpcId.match(/^vpc-[a-z0-9]{8,17}$/)) {
    throw new Error(
      `Invalid PEER_VPC_ID format: ${peerVpcId}. Expected format: vpc-xxxxxxxxx`
    );
  }

  const vpc = new Vpc(scope, 'VispyrVPC', {
    maxAzs: 2,
    ipAddresses: IpAddresses.cidr('10.1.0.0/16'),
    subnetConfiguration: [
      {
        cidrMask: 24,
        name: 'PublicSubnet',
        subnetType: SubnetType.PUBLIC,
      },
      {
        cidrMask: 24,
        name: 'PrivateSubnet',
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    ],
    natGateways: 1,
  });

  const peerVpc = Vpc.fromLookup(scope, 'PeerVpc', {
    vpcId: peerVpcId,
  });

  const peeringConnection = new CfnVPCPeeringConnection(
    scope,
    'VpcPeeringConnection',
    {
      vpcId: vpc.vpcId,
      peerVpcId,
      tags: [
        {
          key: 'Name',
          value: 'VispyrPeeringConnection',
        },
        {
          key: 'Purpose',
          value: 'ObservabilityStack',
        },
      ],
    }
  );

  return { vpc, peerVpc, peeringConnection };
};

export default createVpcWithPeering;
