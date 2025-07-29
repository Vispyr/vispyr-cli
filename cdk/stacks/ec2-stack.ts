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
  CfnEIP,
  CfnVPCPeeringConnection,
  CfnRoute,
  IVpc,
} from 'aws-cdk-lib/aws-ec2';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface Ec2StackProps extends StackProps {
  peerVpcId: string;
}

export class Ec2Stack extends Stack {
  constructor(scope: Construct, id: string, props: Ec2StackProps) {
    super(scope, id, props);

    const { peerVpcId } = props;

    // Validate peerVpcId format
    if (!peerVpcId.match(/^vpc-[a-z0-9]{8,17}$/)) {
      throw new Error(
        `Invalid PEER_VPC_ID format: ${peerVpcId}. Expected format: vpc-xxxxxxxxx`
      );
    }

    // Create custom VPC
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
      natGateways: 1, // One NAT Gateway for cost optimization
    });

    // Import the peer VPC
    const peerVpc = Vpc.fromLookup(this, 'PeerVpc', {
      vpcId: peerVpcId,
    });

    // Create VPC Peering Connection
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

    // Add routes from new VPC to peer VPC
    this.addRoutesToPeerVpc(vpc, peerVpc, peeringConnection);

    // Security group for Vispyr EC2 instance
    const securityGroup = new SecurityGroup(this, 'VispyrSG', {
      vpc,
      allowAllOutbound: true,
      description: 'Security Group for Vispyr Stack',
    });

    // Allow HTTPS traffic from anywhere
    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      'HTTPS access to Grafana'
    );

    // Allow SSH for management (optional - can be removed for production)
    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH access');

    // Allow access from peer VPC for Observability services
    const observabilityPorts = [
      { port: 4173, description: 'OTLP' },
      { port: 9999, description: 'Pyroscope' },
    ];

    observabilityPorts.forEach(({ port, description }) => {
      securityGroup.addIngressRule(
        Peer.ipv4(peerVpc.vpcCidrBlock),
        Port.tcp(port),
        `Allow ${description} access from peer VPC`
      );
    });

    // IAM role for EC2 instance
    const role = new Role(this, 'VispyrInstanceRole', {
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
      'yum install -y docker git nginx openssl',

      // Start and enable services
      'systemctl start docker',
      'systemctl enable docker',
      'systemctl start nginx',
      'systemctl enable nginx',
      'usermod -a -G docker ec2-user',

      // Install Docker Compose
      'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
      'chmod +x /usr/local/bin/docker-compose',

      // Get instance metadata for certificate (with retries)
      'echo "Getting public DNS name..."',
      'for i in {1..50}; do',
      '  DNS_NAME=$(ec2-metadata --public-hostname | cut -d " " -f2)',
      '  if [[ -n "$DNS_NAME" ]]; then',
      '    echo "DNS name resolved: $DNS_NAME"',
      '    break',
      '  fi',
      '  echo "Waiting for DNS name... attempt $i/50"',
      '  sleep 5',
      'done',
      'echo "Using DNS name: $DNS_NAME"',

      // Generate self-signed certificate
      'mkdir -p /etc/nginx/ssl',
      'openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\',
      '  -keyout /etc/nginx/ssl/grafana.key \\',
      '  -out /etc/nginx/ssl/grafana.crt \\',
      '  -subj "/C=US/ST=State/L=City/O=Organization/CN=${DNS_NAME}"',

      // Create nginx configuration with properly escaped variables
      'cat > /etc/nginx/conf.d/grafana.conf << "NGINX_EOF"',
      'server {',
      '    listen 443 ssl;',
      '    server_name DNS_NAME_PLACEHOLDER;',
      '',
      '    ssl_certificate /etc/nginx/ssl/grafana.crt;',
      '    ssl_certificate_key /etc/nginx/ssl/grafana.key;',
      '    ssl_protocols TLSv1.2 TLSv1.3;',
      '    ssl_ciphers HIGH:!aNULL:!MD5;',
      '',
      '    # Security headers',
      '    add_header X-Frame-Options DENY;',
      '    add_header X-Content-Type-Options nosniff;',
      '    add_header X-XSS-Protection "1; mode=block";',
      '',
      '    location / {',
      '        proxy_pass http://127.0.0.1:3000;',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '        proxy_buffering off;',
      '    }',
      '}',
      '',
      '# Redirect HTTP to HTTPS',
      'server {',
      '    listen 80;',
      '    server_name DNS_NAME_PLACEHOLDER;',
      '    return 301 https://$server_name$request_uri;',
      '}',
      'NGINX_EOF',

      // Replace placeholder with actual DNS name
      'sed -i "s/DNS_NAME_PLACEHOLDER/${DNS_NAME}/g" /etc/nginx/conf.d/grafana.conf',

      // Remove default nginx config
      'rm -f /etc/nginx/conf.d/default.conf',

      // Test and reload nginx
      'nginx -t && systemctl reload nginx',

      // Clone and start application
      'cd /home/ec2-user',
      `git clone https://${process.env.PERSONAL_ACCESS_TOKEN}@github.com/Vispyr/vispyr-backend.git`,
      'chown -R ec2-user:ec2-user vispyr-backend',
      'cd vispyr-backend',

      // Start services and wait for Grafana to be ready
      '/usr/local/bin/docker-compose up -d',

      // Wait for Grafana to start
      'echo "Waiting for Grafana to start..."',
      'for i in {1..30}; do',
      '  if curl -s http://localhost:3000/api/health > /dev/null; then',
      '    echo "Grafana is ready"',
      '    break',
      '  fi',
      '  echo "Waiting for Grafana... ($i/30)"',
      '  sleep 10',
      'done',

      // Change bucket size to accomodate large server name
      'sed -i "/http {/a     server_names_hash_bucket_size 128;" /etc/nginx/nginx.conf',

      // Final nginx reload to ensure everything is working
      'systemctl reload nginx',

      'echo "Setup complete. HTTPS endpoint should be available."'
    );

    // Create EC2 instance in public subnet (needed for HTTPS access)
    const instance = new Instance(this, 'ObservabilityInstance', {
      vpc,
      instanceType: new InstanceType('t3.small'), // Upgraded from micro for better performance
      machineImage: MachineImage.latestAmazonLinux2023(),
      role,
      securityGroup,
      userData,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
    });

    // Associate Elastic IP with instance
    new CfnEIP(this, 'VispyrEIPAssociation', {
      domain: 'vpc',
      instanceId: instance.instanceId,
    });

    // Outputs
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

    // VPC Peering outputs
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

    // Manual route setup instructions
    new CfnOutput(this, 'PeerVpcRouteInstructions', {
      value: `To complete peering: Add route in peer VPC route tables - Destination: ${vpc.vpcCidrBlock}, Target: ${peeringConnection.attrId}`,
      description: 'Manual route setup required in peer VPC',
    });
  }

  private addRoutesToPeerVpc(
    vpc: Vpc,
    peerVpc: IVpc,
    peeringConnection: CfnVPCPeeringConnection
  ) {
    // Add routes from new VPC to peer VPC
    vpc.publicSubnets.forEach((subnet, index) => {
      const route = new CfnRoute(this, `PublicRoute${index}ToPeer`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: peerVpc.vpcCidrBlock,
        vpcPeeringConnectionId: peeringConnection.attrId,
      });

      // Ensure the route depends on the peering connection
      route.addDependency(peeringConnection);
    });

    vpc.privateSubnets.forEach((subnet, index) => {
      const route = new CfnRoute(this, `PrivateRoute${index}ToPeer`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: peerVpc.vpcCidrBlock,
        vpcPeeringConnectionId: peeringConnection.attrId,
      });

      // Ensure the route depends on the peering connection
      route.addDependency(peeringConnection);
    });
  }
}
