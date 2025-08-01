import {
  DescribeRouteTablesCommand,
  DescribeSubnetsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import { styleLog } from '../shared';

const PROMPT = 'blue';

interface SubnetInfo {
  subnetId: string;
  name: string;
  cidr: string;
  routeTableId: string;
}

const getSubnetsWithRouteTables = async (
  vpcId: string,
  region: string
): Promise<SubnetInfo[]> => {
  styleLog(PROMPT, '\nRetrieving peer VPC subnet information...');
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

export default getSubnetsWithRouteTables;
