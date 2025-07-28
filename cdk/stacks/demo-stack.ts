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
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class DemoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create custom VPC with public subnets
    const vpc = new Vpc(this, 'DemoVPC', {
      maxAzs: 2,
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
    });

    // Security group for EC2 instance (Node app + SSH)
    const securityGroup = new SecurityGroup(this, 'DemoSG', {
      vpc,
      allowAllOutbound: true,
      description: 'Allow Node app and SSH access',
    });

    // Allow Node app traffic from anywhere
    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(3001),
      'Node app port'
    );

    // Allow SSH access
    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH access');

    // IAM role for EC2 instance
    const role = new Role(this, 'DemoInstanceRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // User data script for instance setup
    const userData = UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'yum update -y',
      'yum install -y nodejs npm git postgresql15-server postgresql15',

      // Initialize PostgreSQL
      'postgresql-setup --initdb',
      'systemctl enable postgresql',
      'systemctl start postgresql',

      // Set up database and user
      'sudo -u postgres psql -c "CREATE USER testuser WITH PASSWORD \'testpass\';"',
      'sudo -u postgres psql -c "CREATE DATABASE telemetry_test OWNER testuser;"',
      'sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE telemetry_test TO testuser;"',

      // Configure PostgreSQL to allow local connections
      "sed -i \"s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/\" /var/lib/pgsql/data/postgresql.conf",
      'echo "host all all 127.0.0.1/32 md5" >> /var/lib/pgsql/data/pg_hba.conf',
      'echo "local all all md5" >> /var/lib/pgsql/data/pg_hba.conf',
      'systemctl restart postgresql',

      // Clone as ec2-user
      `su - ec2-user -c "cd /home/ec2-user && git clone https://${process.env.PERSONAL_ACCESS_TOKEN}@github.com/Vispyr/vispyr-test-app.git"`,

      // Install and start app as ec2-user
      'su - ec2-user -c "cd /home/ec2-user/vispyr-test-app/server_main && npm install"',

      // Create log file with proper permissions
      'touch /var/log/app.log',
      'chown ec2-user:ec2-user /var/log/app.log',

      // Set environment variables and start app as ec2-user
      'su - ec2-user -c "cd /home/ec2-user/vispyr-test-app/server_main && DB_USER=testuser DB_HOST=localhost DB_NAME=telemetry_test DB_PASSWORD=testpass DB_PORT=5432 nohup npm run dev > /var/log/app.log 2>&1 &"',

      // Wait for app to be ready
      'echo "Waiting for app to start..."',
      'for i in {1..30}; do',
      '  if curl -s http://localhost:3001/api/profile/efficient-sort > /dev/null; then',
      '    echo "Server is ready"',
      '    break',
      '  fi',
      '  echo "Waiting for app... ($i/30)"',
      '  sleep 10',
      'done',

      'echo "Setup complete. App should be available on port 3001"'
    );

    // Create EC2 instance in public subnet (needed for public access)
    const instance = new Instance(this, 'ObservabilityInstance', {
      vpc,
      instanceType: new InstanceType('t3.micro'),
      machineImage: MachineImage.latestAmazonLinux2023(),
      role,
      securityGroup,
      userData,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
    });

    // Outputs
    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      exportName: 'DemoInstanceId',
      description: 'Instance ID of the Demo EC2 instance',
    });

    new CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
      exportName: 'DemoInstancePublicIP',
      description: 'Public IP of the Demo EC2 instance',
    });

    new CfnOutput(this, 'AppURL', {
      value: `http://${instance.instancePublicIp}:3001`,
      exportName: 'DemoAppURL',
      description: 'URL to access the Node.js application',
    });

    new CfnOutput(this, 'VPCId', {
      value: vpc.vpcId,
      exportName: 'DemoVPCId',
      description: 'VPC ID for the Demo stack',
    });
  }
}
