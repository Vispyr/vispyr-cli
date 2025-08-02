import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import ora from 'ora';

const waitForInstanceReady = async (
  instanceId: string,
  region: string
): Promise<void> => {
  const ec2Client = new EC2Client({ region });
  const spinner = ora('Waiting for EC2 instance to be ready...').start();

  let attempts = 0;
  const maxAttempts = 30;

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

      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    } catch (error) {
      spinner.fail('Failed to check instance status');
      throw error;
    }
  }

  spinner.fail('Instance did not become ready within timeout');
  throw new Error('Instance readiness timeout');
};

export default waitForInstanceReady;
