import {
  AcceptVpcPeeringConnectionCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import ora from 'ora';
import { Region } from '../../types';

const acceptPeeringConnection = async (
  peeringConnectionId: string,
  region: Region
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

export default acceptPeeringConnection;
