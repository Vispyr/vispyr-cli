import { Stack, StackProps, Fn } from 'aws-cdk-lib';
import {
  Instance,
  InstanceType,
  MachineImage,
  Vpc,
  SecurityGroup,
  Peer,
  Port,
  SubnetType,
  CfnEIP,
  CfnVPCPeeringConnection,
  CfnRoute,
  IVpc,
  IpAddresses,
} from 'aws-cdk-lib/aws-ec2';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { StringParameter, ParameterTier } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { generateUserData } from '../utils/generateUserData';
import vispyrBackendCommands from '../user_commands/vispyrBackendCommands';

interface VispyrBackendProps extends StackProps {
  peerVpcId: string;
}

export class VispyrBackend extends Stack {
  constructor(scope: Construct, id: string, props: VispyrBackendProps) {
    super(scope, id, props);

    const { peerVpcId } = props;

    if (!peerVpcId.match(/^vpc-[a-z0-9]{8,17}$/)) {
      throw new Error(
        `Invalid PEER_VPC_ID format: ${peerVpcId}. Expected format: vpc-xxxxxxxxx`
      );
    }

    const vpc = new Vpc(this, 'VispyrVPC', {
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

    const peerVpc = Vpc.fromLookup(this, 'PeerVpc', {
      vpcId: peerVpcId,
    });

    const peeringConnection = new CfnVPCPeeringConnection(
      this,
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

    this.addRoutesToPeerVpc(vpc, peerVpc, peeringConnection);

    const securityGroup = new SecurityGroup(this, 'VispyrSG', {
      vpc,
      allowAllOutbound: true,
      description: 'Security Group for Vispyr Stack',
    });

    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      'HTTPS access to Grafana'
    );

    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH access');

    const observabilityPorts = [
      { port: 4317, description: 'OTLP' },
      { port: 9999, description: 'Pyroscope' },
      { port: 9090, description: 'Node Exporter' },
    ];

    observabilityPorts.forEach(({ port, description }) => {
      securityGroup.addIngressRule(
        Peer.ipv4(peerVpc.vpcCidrBlock),
        Port.tcp(port),
        `Allow ${description} access from peer VPC`
      );
    });

    const role = new Role(this, 'VispyrInstanceRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const userData = generateUserData(vispyrBackendCommands);

    const instance = new Instance(this, 'VispyrBackend', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestAmazonLinux2023(),
      role,
      securityGroup,
      userData,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
    });

    const eip = new CfnEIP(this, 'VispyrEIPAssociation', {
      domain: 'vpc',
      instanceId: instance.instanceId,
    });

    this.storeDeploymentParameters(instance, peeringConnection, eip, vpc);
  }

  private storeDeploymentParameters(
    instance: Instance,
    peeringConnection: CfnVPCPeeringConnection,
    eip: CfnEIP,
    vpc: Vpc
  ) {
    const parameterPrefix = '/vispyr/backend';

    new StringParameter(this, 'InstanceIdParameter', {
      parameterName: `${parameterPrefix}/instance-id`,
      stringValue: instance.instanceId,
      description: 'Vispyr Backend EC2 Instance ID',
      tier: ParameterTier.STANDARD,
    });

    new StringParameter(this, 'PublicIPParameter', {
      parameterName: `${parameterPrefix}/public-ip`,
      stringValue: eip.ref,
      description: 'Vispyr Backend Public IP Address',
      tier: ParameterTier.STANDARD,
    });

    new StringParameter(this, 'PrivateIPParameter', {
      parameterName: `${parameterPrefix}/private-ip`,
      stringValue: instance.instancePrivateIp,
      description: 'Vispyr Backend Private IP Address',
      tier: ParameterTier.STANDARD,
    });

    const region = process.env.AWS_REGION || this.region;
    const computeDomain =
      region === 'us-east-1'
        ? 'compute-1.amazonaws.com'
        : `${region}.compute.amazonaws.com`;

    const httpsEndpoint = Fn.sub('https://ec2-${EipWithDashes}.${Domain}', {
      EipWithDashes: Fn.join('-', Fn.split('.', eip.ref)),
      Domain: computeDomain,
    });

    new StringParameter(this, 'HttpsEndpointParameter', {
      parameterName: `${parameterPrefix}/https-endpoint`,
      stringValue: httpsEndpoint,
      description: 'Vispyr Backend HTTPS Endpoint URL',
      tier: ParameterTier.STANDARD,
    });

    new StringParameter(this, 'PeeringConnectionIdParameter', {
      parameterName: `${parameterPrefix}/peering-connection-id`,
      stringValue: peeringConnection.attrId,
      description: 'VPC Peering Connection ID',
      tier: ParameterTier.STANDARD,
    });

    new StringParameter(this, 'VpcIdParameter', {
      parameterName: `${parameterPrefix}/vpc-id`,
      stringValue: vpc.vpcId,
      description: 'Vispyr Backend VPC ID',
      tier: ParameterTier.STANDARD,
    });

    new StringParameter(this, 'DeploymentTimestampParameter', {
      parameterName: `${parameterPrefix}/deployment-timestamp`,
      stringValue: new Date().toISOString(),
      description: 'Timestamp of last deployment',
      tier: ParameterTier.STANDARD,
    });
  }

  private addRoutesToPeerVpc(
    vpc: Vpc,
    peerVpc: IVpc,
    peeringConnection: CfnVPCPeeringConnection
  ) {
    vpc.publicSubnets.forEach((subnet, index) => {
      const route = new CfnRoute(this, `PublicRoute${index}ToPeer`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: peerVpc.vpcCidrBlock,
        vpcPeeringConnectionId: peeringConnection.attrId,
      });

      route.addDependency(peeringConnection);
    });

    vpc.privateSubnets.forEach((subnet, index) => {
      const route = new CfnRoute(this, `PrivateRoute${index}ToPeer`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: peerVpc.vpcCidrBlock,
        vpcPeeringConnectionId: peeringConnection.attrId,
      });

      route.addDependency(peeringConnection);
    });
  }
}
