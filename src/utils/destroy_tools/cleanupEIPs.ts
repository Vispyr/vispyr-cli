import {
  DescribeAddressesCommand,
  EC2Client,
  ReleaseAddressCommand,
} from '@aws-sdk/client-ec2';
import ora from 'ora';

const cleanupEIPs = async () => {
  const eipCleanupSpinner = ora(
    'Cleaning up any remaining Elastic IPs...'
  ).start();
  try {
    const ec2 = new EC2Client({ region: process.env.AWS_REGION });
    const { Addresses } = await ec2.send(new DescribeAddressesCommand({}));

    const unattachedEIPs = Addresses?.filter(
      (addr) => !addr.InstanceId && addr.AllocationId
    );

    if (unattachedEIPs && unattachedEIPs.length > 0) {
      for (const eip of unattachedEIPs) {
        if (eip.AllocationId) {
          await ec2.send(
            new ReleaseAddressCommand({ AllocationId: eip.AllocationId })
          );
          eipCleanupSpinner.text = `Released Elastic IP: ${eip.PublicIp}`;
        }
      }
      eipCleanupSpinner.succeed(
        `Released ${unattachedEIPs.length} Elastic IP(s)`
      );
    } else {
      eipCleanupSpinner.succeed('No unattached Elastic IPs found');
    }
  } catch (error) {
    eipCleanupSpinner.warn(
      'Could not clean up Elastic IPs - check AWS console manually'
    );
  }
};

export default cleanupEIPs;
