import { DescribeAddressesCommand, EC2Client } from '@aws-sdk/client-ec2';
import ora from 'ora';

const findEIPs = async () => {
  const eipSpinner = ora('Checking for Elastic IPs...').start();
  try {
    const ec2 = new EC2Client({ region: process.env.AWS_REGION });
    const { Addresses } = await ec2.send(new DescribeAddressesCommand({}));

    const unattachedEIPs = Addresses?.filter(
      (addr) => !addr.InstanceId && addr.AllocationId
    );

    if (unattachedEIPs && unattachedEIPs.length > 0) {
      eipSpinner.text = `Found ${unattachedEIPs.length} unattached Elastic IP(s), will clean up after stack destruction...`;
    }
    eipSpinner.succeed('Elastic IP check complete');
  } catch (error) {
    eipSpinner.warn(
      'Could not check Elastic IPs - continuing with stack destruction'
    );
  }
};

export default findEIPs;
