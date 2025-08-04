import { DescribeVpcsCommand, EC2Client } from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import { p, sleep } from '../shared.js';
import checkEnvFile from './envService.js';
import { Region } from '../../types.js';
import ora from 'ora';

const getPeerVpcId = async (region: Region) => {
  const peerVpcSpinner = ora('Searching for your VPC...').start();
  await sleep(2000);

  const { hasEnv, peerVpcId } = checkEnvFile();

  if (!hasEnv) {
    p(chalk.red('.env file not found.'));
    p(chalk.yellow('Please create a .env file with PEER_VPC_ID=vpc-xxxxxxxxx'));
    process.exit(1);
  }

  if (!peerVpcId) {
    p(chalk.red('PEER_VPC_ID not found in .env file'));
    p(chalk.yellow('Please add PEER_VPC_ID=vpc-xxxxxxxxx to your .env file'));
    process.exit(1);
  }

  const cidrBlock = await validatePeerVpc(peerVpcId, region);
  peerVpcSpinner.succeed(`Found peer VPC: ${peerVpcId} (${cidrBlock})`);

  return { peerVpcId, cidrBlock };
};

const validatePeerVpc = async (peerVpcId: string, region: Region) => {
  try {
    const ec2Client = new EC2Client({ region });
    const response = await ec2Client.send(
      new DescribeVpcsCommand({
        VpcIds: [peerVpcId],
      })
    );

    const vpc = response.Vpcs?.[0];
    if (!vpc) {
      console.error('Could not find VPC:', peerVpcId);
      process.exit(1);
    }

    if (!vpc.CidrBlock) {
      p(chalk.red(`Invalid peer VPC: ${peerVpcId}`));
      process.exit(1);
    }

    return vpc.CidrBlock;
  } catch (error) {
    console.error(chalk.red(`Could not find VPC ${peerVpcId}:`, error));
    process.exit(1);
  }
};

export default getPeerVpcId;
