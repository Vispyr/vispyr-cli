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
      '#!/bin/bash',
      'yum update -y',
      'yum install -y docker git',
      'systemctl start docker',
      'systemctl enable docker',
      'usermod -a -G docker ec2-user',
      'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
      'chmod +x /usr/local/bin/docker-compose',
      'cd /home/ec2-user',
      `git clone https://${process.env.PERSONAL_ACCESS_TOKEN}@github.com/Vispyr/vispyr-backend.git`,
      'chown -R ec2-user:ec2-user vispyr-backend',
      'cd vispyr-backend',
      '/usr/local/bin/docker-compose up -d'
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

    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      exportName: 'InstanceId',
      description: 'Instance ID of the monitoring EC2 instance',
    });

    new CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
      exportName: 'InstancePublicIP',
      description: 'Public IP of the monitoring EC2 instance',
    });
  }
}
