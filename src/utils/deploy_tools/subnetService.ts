import chalk from 'chalk';
import { p } from '../shared';
import {
  DescribeRouteTablesCommand,
  DescribeSubnetsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import inquirer from 'inquirer';
import { Region } from '../../types';

interface SubnetInfo {
  subnetId: string;
  name: string;
  cidr: string;
  routeTableId: string;
}

interface PromptAnswers {
  selectedSubnet: SubnetInfo;
}

const selectSubnet = async (peerVpcId: string, region: Region) => {
  const subnets = await getSubnetsWithRouteTables(peerVpcId, region);

  if (subnets.length === 0) {
    p(chalk.red('No subnets found in peer VPC'));
    process.exit(1);
  }

  const subnetChoices = subnets.map((subnet) => ({
    name: `${subnet.name} (${subnet.subnetId} - ${subnet.cidr})`,
    value: subnet,
  }));

  const { selectedSubnet } = await inquirer.prompt<PromptAnswers>([
    {
      type: 'list',
      name: 'selectedSubnet',
      message: chalk.cyan(
        'Select the subnet whose route table should receive the return route:'
      ),
      choices: subnetChoices,
      pageSize: 15,
    },
  ]);

  p(
    chalk.green(
      `Selected: ${selectedSubnet.name} (Route Table: ${selectedSubnet.routeTableId})`
    )
  );

  return selectedSubnet;
};

const getSubnetsWithRouteTables = async (
  vpcId: string,
  region: Region
): Promise<SubnetInfo[]> => {
  p(chalk.blue('\nRetrieving peer VPC subnet information...'));
  const ec2Client = new EC2Client({ region });

  try {
    const subnetsResponse = await ec2Client.send(
      new DescribeSubnetsCommand({
        Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
      })
    );

    const routeTablesResponse = await ec2Client.send(
      new DescribeRouteTablesCommand({
        Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
      })
    );

    const subnets = subnetsResponse.Subnets || [];
    const routeTables = routeTablesResponse.RouteTables || [];

    const mainRouteTable = routeTables.find((rt) =>
      rt.Associations?.some((assoc) => assoc.Main)
    );

    const subnetInfos: SubnetInfo[] = subnets.map((subnet) => {
      const subnetId = subnet.SubnetId!;
      const cidr = subnet.CidrBlock!;

      const nameTag = subnet.Tags?.find((tag) => tag.Key === 'Name');
      const name = nameTag?.Value || 'Unnamed Subnet';

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

export default selectSubnet;
