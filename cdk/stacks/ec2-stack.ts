import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import {
  Instance,
  InstanceType,
  MachineImage,
  Vpc,
  SecurityGroup,
  Peer,
  Port,
  UserData,
  // KeyPair,
} from 'aws-cdk-lib/aws-ec2';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class Ec2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });

    const securityGroup = new SecurityGroup(this, 'MonitoringSG', {
      vpc,
      allowAllOutbound: true,
      description: 'Allow SSH and container ports',
    });

    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH');
    [3000, 9090, 4317, 3100, 4040].forEach((port) => {
      securityGroup.addIngressRule(
        Peer.anyIpv4(),
        Port.tcp(port),
        `Allow port ${port}`
      );
    });

    const role = new Role(this, 'InstanceRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const userData = UserData.forLinux();
    userData.addCommands(
      'yum update -y',
      'yum install -y docker',
      'systemctl enable docker',
      'systemctl start docker',
      'usermod -aG docker ec2-user',
      'docker run -d --name grafana -p 3000:3000 grafana/grafana',
      'docker run -d --name prometheus -p 9090:9090 prom/prometheus',
      'docker run -d --name tempo -p 4317:4317 grafana/tempo',
      'docker run -d --name pyroscope -p 4040:4040 grafana/pyroscope',
      'docker run -d --name alloy grafana/alloy'
    );

    // const key = KeyPair.fromKeyPairName(this, 'Key', 'vispyr-key');

    const instance = new Instance(this, 'MonitoringInstance', {
      vpc,
      instanceType: new InstanceType('t3.micro'),
      machineImage: MachineImage.latestAmazonLinux2023(),
      role,
      securityGroup,
      userData,
      // keyPair: key
    });

    new CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
      description: 'Public IP of the monitoring EC2 instance',
    });
  }
}
