import { Construct } from 'constructs';
import { SecurityGroup, Vpc, Peer, Port } from 'aws-cdk-lib/aws-ec2';

const createSecurityGroup = (
  scope: Construct,
  vpc: Vpc,
  peerVpcCidr: string
): SecurityGroup => {
  const securityGroup = new SecurityGroup(scope, 'VispyrSG', {
    vpc,
    allowAllOutbound: true,
    description: 'Security Group for Vispyr Stack',
  });

  securityGroup.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(443),
    'HTTPS access to Grafana'
  );

  securityGroup.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(80),
    'HTTP access for Letss Encrypt validation'
  );

  securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH access');

  const observabilityPorts = [
    { port: 4317, description: 'OTLP' },
    { port: 9999, description: 'Pyroscope' },
    { port: 9090, description: 'Node Exporter' },
  ];

  observabilityPorts.forEach(({ port, description }) => {
    securityGroup.addIngressRule(
      Peer.ipv4(peerVpcCidr),
      Port.tcp(port),
      `Allow ${description} access from peer VPC`
    );
  });

  return securityGroup;
};

export default createSecurityGroup;
