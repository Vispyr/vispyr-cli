import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
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
} from 'aws-cdk-lib/aws-ec2';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
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
      cidr: '10.1.0.0/16',
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

    new CfnEIP(this, 'VispyrEIPAssociation', {
      domain: 'vpc',
      instanceId: instance.instanceId,
    });

    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      exportName: 'VispyrInstanceId',
      description: 'Instance ID of the Vispyr EC2 instance',
    });

    new CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
      exportName: 'VispyrInstancePublicIP',
      description: 'Public IP of the Vispyr EC2 instance',
    });

    new CfnOutput(this, 'HTTPSEndpoint', {
      value: `https://${instance.instancePublicDnsName}`,
      exportName: 'VispyrHTTPSEndpoint',
      description: 'HTTPS endpoint for Grafana access',
    });

    new CfnOutput(this, 'VPCId', {
      value: vpc.vpcId,
      exportName: 'VispyrVPCId',
      description: 'VPC ID for the observability stack',
    });

    new CfnOutput(this, 'VpcCidr', {
      value: vpc.vpcCidrBlock,
      description: 'CIDR block of the created VPC',
    });

    new CfnOutput(this, 'InstancePrivateIp', {
      value: instance.instancePrivateIp,
      description: 'Private IP of the EC2 instance',
    });

    new CfnOutput(this, 'PeeringConnectionId', {
      value: peeringConnection.attrId,
      description: 'VPC Peering Connection ID',
    });

    new CfnOutput(this, 'PeerVpcId', {
      value: peerVpcId,
      description: 'Peer VPC ID',
    });

    new CfnOutput(this, 'PeerVpcCidr', {
      value: peerVpc.vpcCidrBlock,
      description: 'Peer VPC CIDR block',
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
