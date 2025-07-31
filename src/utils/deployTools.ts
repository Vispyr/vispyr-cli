import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  AcceptVpcPeeringConnectionCommand,
  CreateRouteCommand,
  DeleteRouteCommand,
  DescribeInstancesCommand,
  DescribeRouteTablesCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import ora from 'ora';

interface DeploymentOutputs {
  instanceId?: string;
  publicIp?: string;
  httpsEndpoint?: string;
  vpcId?: string;
  peeringConnectionId?: string;
  peerVpcId?: string;
}

interface SubnetInfo {
  subnetId: string;
  name: string;
  cidr: string;
  routeTableId: string;
}

interface AddedRoute {
  routeTableId: string;
  destinationCidr: string;
  peeringConnectionId: string;
}

type Color =
  | 'red'
  | 'blue'
  | 'cyan'
  | 'yellow'
  | 'green'
  | 'gray'
  | 'blue bold';

const execAsync = promisify(exec);
const outputsPath = path.resolve(process.cwd(), 'outputs.json');
let addedRoutes: AddedRoute[] = [];

export const getStackOutputs = async (): Promise<DeploymentOutputs> => {
  try {
    // Get outputs from CDK deployment
    const { stdout } = await execAsync('npx cdk list');
    const stacks = stdout.trim().split('\n');

    if (stacks.length === 0) {
      throw new Error('No CDK stacks found');
    }

    if (fs.existsSync(outputsPath)) {
      const outputs = JSON.parse(fs.readFileSync('outputs.json', 'utf8'));
      const stackName = Object.keys(outputs)[0];
      const stackOutputs = outputs[stackName];

      return {
        instanceId: stackOutputs.InstanceId,
        publicIp: stackOutputs.InstancePublicIP,
        httpsEndpoint: stackOutputs.HTTPSEndpoint,
        vpcId: stackOutputs.VpcId,
        peeringConnectionId: stackOutputs.PeeringConnectionId,
        peerVpcId: stackOutputs.PeerVpcId,
      };
    }

    return {};
  } catch (error) {
    console.warn(
      chalk.yellow('Could not retrieve stack outputs automatically')
    );
    return {};
  }
};

export const generateNonOverlappingCidr = (peerVpcCidr: string): string => {
  // Extract the first two octets from peer VPC CIDR (e.g., "10.0" from "10.0.0.0/16")
  const peerOctets = peerVpcCidr.split('.').slice(0, 2);

  // Generate a different second octet
  const secondOctet = parseInt(peerOctets[1]);
  const newSecondOctet = secondOctet === 0 ? 1 : secondOctet === 1 ? 2 : 0;

  return `${peerOctets[0]}.${newSecondOctet}.0.0/16`;
};

export const getSubnetsWithRouteTables = async (
  vpcId: string,
  region: string
): Promise<SubnetInfo[]> => {
  const ec2Client = new EC2Client({ region });

  try {
    // Get all subnets in the VPC
    const subnetsResponse = await ec2Client.send(
      new DescribeSubnetsCommand({
        Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
      })
    );

    // Get all route tables in the VPC
    const routeTablesResponse = await ec2Client.send(
      new DescribeRouteTablesCommand({
        Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
      })
    );

    const subnets = subnetsResponse.Subnets || [];
    const routeTables = routeTablesResponse.RouteTables || [];

    // Find the main route table
    const mainRouteTable = routeTables.find((rt) =>
      rt.Associations?.some((assoc) => assoc.Main)
    );

    const subnetInfos: SubnetInfo[] = subnets.map((subnet) => {
      const subnetId = subnet.SubnetId!;
      const cidr = subnet.CidrBlock!;

      // Get subnet name from tags
      const nameTag = subnet.Tags?.find((tag) => tag.Key === 'Name');
      const name = nameTag?.Value || 'Unnamed Subnet';

      // Find associated route table
      let routeTableId = mainRouteTable?.RouteTableId!;

      for (const rt of routeTables) {
        const association = rt.Associations?.find(
          (assoc) => assoc.SubnetId === subnetId
        );
        if (association) {
          routeTableId = rt.RouteTableId!;
          break;
        }
      }

      return {
        subnetId,
        name,
        cidr,
        routeTableId,
      };
    });

    return subnetInfos.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error(chalk.red('Failed to retrieve subnet information:'), error);
    throw error;
  }
};

export const validatePeerVpc = async (
  peerVpcId: string,
  region: string
): Promise<{ isValid: boolean; cidrBlock?: string }> => {
  try {
    const ec2Client = new EC2Client({ region });
    const response = await ec2Client.send(
      new DescribeVpcsCommand({
        VpcIds: [peerVpcId],
      })
    );

    const vpc = response.Vpcs?.[0];
    if (!vpc) {
      return { isValid: false };
    }

    console.log(
      chalk.green(`✅ Found peer VPC: ${peerVpcId} (${vpc.CidrBlock})`)
    );
    return { isValid: true, cidrBlock: vpc.CidrBlock };
  } catch (error) {
    console.error(chalk.red(`❌ Could not find VPC ${peerVpcId}:`, error));
    return { isValid: false };
  }
};

export const addRouteToSubnet = async (
  routeTableId: string,
  destinationCidr: string,
  peeringConnectionId: string,
  region: string
): Promise<void> => {
  try {
    const ec2Client = new EC2Client({ region });
    const spinner = ora(
      `Adding route to route table ${routeTableId}...`
    ).start();

    await ec2Client.send(
      new CreateRouteCommand({
        RouteTableId: routeTableId,
        DestinationCidrBlock: destinationCidr,
        VpcPeeringConnectionId: peeringConnectionId,
      })
    );

    // Track the added route for potential cleanup
    addedRoutes.push({
      routeTableId,
      destinationCidr,
      peeringConnectionId,
    });

    spinner.succeed(`Route added: ${destinationCidr} → ${peeringConnectionId}`);
  } catch (error) {
    console.error(chalk.red('Failed to add route:'), error);
    throw error;
  }
};

export const cleanupAddedRoutes = async (region: string): Promise<void> => {
  if (addedRoutes.length === 0) return;

  console.log(chalk.yellow('\n🧹 Cleaning up added routes...'));
  const ec2Client = new EC2Client({ region });

  for (const route of addedRoutes) {
    try {
      const spinner = ora(
        `Removing route from ${route.routeTableId}...`
      ).start();

      await ec2Client.send(
        new DeleteRouteCommand({
          RouteTableId: route.routeTableId,
          DestinationCidrBlock: route.destinationCidr,
        })
      );

      spinner.succeed(`Route removed from ${route.routeTableId}`);
    } catch (error) {
      console.warn(
        chalk.yellow(`Failed to cleanup route in ${route.routeTableId}:`),
        error
      );
    }
  }

  addedRoutes = [];
};

export const acceptPeeringConnection = async (
  peeringConnectionId: string,
  region: string
): Promise<void> => {
  try {
    const ec2Client = new EC2Client({ region });
    const spinner = ora('Accepting VPC peering connection...').start();

    await ec2Client.send(
      new AcceptVpcPeeringConnectionCommand({
        VpcPeeringConnectionId: peeringConnectionId,
      })
    );

    spinner.succeed(`VPC peering connection ${peeringConnectionId} accepted`);
  } catch (error) {
    console.error(chalk.red('Failed to accept peering connection:'), error);
    throw error;
  }
};

export const checkEnvFile = (): { hasEnv: boolean; peerVpcId?: string } => {
  const envPath = path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    return { hasEnv: false };
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const peerVpcMatch = envContent.match(/PEER_VPC_ID=(.+)/);

  if (peerVpcMatch) {
    const peerVpcId = peerVpcMatch[1].trim().replace(/['"]/g, '');
    return { hasEnv: true, peerVpcId };
  }

  return { hasEnv: true };
};

export const waitForInstanceReady = async (
  instanceId: string,
  region: string
): Promise<void> => {
  const ec2Client = new EC2Client({ region });
  const spinner = ora('Waiting for EC2 instance to be ready...').start();

  let attempts = 0;
  const maxAttempts = 30; // 5 minutes with 10-second intervals

  while (attempts < maxAttempts) {
    try {
      const response = await ec2Client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        })
      );

      const instance = response.Reservations?.[0]?.Instances?.[0];
      if (instance?.State?.Name === 'running' && instance?.PublicIpAddress) {
        spinner.succeed(
          `Instance ${instanceId} is ready at ${instance.PublicIpAddress}`
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    } catch (error) {
      spinner.fail('Failed to check instance status');
      throw error;
    }
  }

  spinner.fail('Instance did not become ready within timeout');
  throw new Error('Instance readiness timeout');
};

export const waitForHTTPSReady = async (
  httpsEndpoint: string
): Promise<void> => {
  const spinner = ora(
    'Waiting for HTTPS endpoint and application deployment...'
  ).start();

  let attempts = 0;
  const maxAttempts = 90; // 15 minutes with 10-second intervals

  while (attempts < maxAttempts) {
    try {
      // Use curl to test HTTPS endpoint, accepting self-signed certificates
      const { stdout } = await execAsync(
        `curl -k -s -o /dev/null -w "%{http_code}" ${httpsEndpoint}/api/health || echo "000"`
      );

      if (stdout.trim() === '200') {
        spinner.succeed('HTTPS endpoint is ready and Grafana is responding');
        return;
      }

      const minutes = Math.floor((attempts * 10) / 60);
      const seconds = (attempts * 10) % 60;
      spinner.text = `Waiting for HTTPS endpoint... (${minutes}:${seconds
        .toString()
        .padStart(2, '0')} elapsed)`;

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    } catch (error) {
      // Continue trying even if curl fails
      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    }
  }

  spinner.warn(
    'HTTPS endpoint monitoring timeout - deployment may still be in progress'
  );
};

export const showServiceInfo = (
  httpsEndpoint: string,
  peeringInfo?: { peerVpcId: string; peeringConnectionId: string }
): void => {
  console.log(chalk.blue.bold('\n🎉 Deployment Complete!\n'));
  console.log(chalk.green('Your observability stack is now running at:'));
  console.log(chalk.cyan.bold(`• Grafana (HTTPS): ${httpsEndpoint}`));

  if (peeringInfo) {
    console.log(chalk.blue.bold('\n🔗 VPC Peering Information:'));
    console.log(chalk.green(`• Peer VPC ID: ${peeringInfo.peerVpcId}`));
    console.log(
      chalk.green(`• Peering Connection ID: ${peeringInfo.peeringConnectionId}`)
    );
    console.log(
      chalk.green('• Return routes have been automatically configured')
    );
    console.log(
      chalk.yellow(
        '• Services are accessible from the peer VPC via private IPs'
      )
    );
  }

  console.log(chalk.yellow.bold('\n⚠️  Important Security Notice:'));
  console.log(chalk.yellow('This deployment uses a self-signed certificate.'));
  console.log(
    chalk.yellow(
      'Your browser will show security warnings that you need to accept.'
    )
  );
  console.log(
    chalk.yellow('This is normal and expected for self-signed certificates.\n')
  );

  console.log(chalk.blue('\n📋 Next Steps:'));
  console.log(
    chalk.white('1. Open the Grafana UI:'),
    chalk.green(httpsEndpoint)
  );
  console.log(
    chalk.white(
      '2. Accept the security warning for the self-signed certificate'
    )
  );
  console.log(chalk.white('3. Log in to Grafana'));
  console.log(chalk.white('   username:'), chalk.green('admin'));
  console.log(chalk.white('   password:'), chalk.green('admin'));

  if (peeringInfo) {
    console.log(chalk.blue('\n🔧 VPC Peering Setup:'));
    console.log(
      chalk.green('4. ✅ VPC peering connection has been created and accepted')
    );
    console.log(
      chalk.green('5. ✅ Return routes have been automatically configured')
    );
    console.log(
      chalk.green('6. ✅ Services are ready for cross-VPC communication')
    );
  }
};

export const acknowledgeNotice = async (noticeId: number) => {
  try {
    await execAsync(`npx cdk acknowledge ${noticeId}`);
  } catch (error) {
    // Notice might not exist, continue
  }
};

export const logWithStyle = (color: Color, message: string) => {
  switch (color) {
    case 'red':
      return console.log(chalk.red(message));
    case 'blue':
      return console.log(chalk.blue(message));
    case 'cyan':
      return console.log(chalk.cyan(message));
    case 'yellow':
      return console.log(chalk.yellow(message));
    case 'green':
      return console.log(chalk.green(message));
    case 'gray':
      return console.log(chalk.gray(message));
    case 'blue bold':
      return console.log(chalk.blue.bold(message));
  }
};
