import { DescribeVpcsCommand, EC2Client } from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import { p } from '../shared';

const validatePeerVpc = async (
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

    p(chalk.green(`Found peer VPC: ${peerVpcId} (${vpc.CidrBlock})`));
    return { isValid: true, cidrBlock: vpc.CidrBlock };
  } catch (error) {
    console.error(chalk.red(`Could not find VPC ${peerVpcId}:`, error));
    return { isValid: false };
  }
};

export default validatePeerVpc;
