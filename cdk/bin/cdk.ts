import { App } from 'aws-cdk-lib';
import { Ec2Stack } from '../stacks/ec2-stack.js';
import { fromIni } from '@aws-sdk/credential-providers';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import path from 'path';
import process from 'process';

async function getAccountIdAndRegion() {
  // Load credentials from default profile and default config location
  const credentials = fromIni({
    filepath: path.resolve(process.env.HOME || '', '.aws/credentials'),
    configFilepath: path.resolve(process.env.HOME || '', '.aws/config'),
    profile: 'default',
  });

  // Read region from config file (or fallback)
  // You can also hardcode or read from process.env.AWS_REGION, etc.
  const region = process.env.AWS_REGION || 'us-east-2';

  // Create STS client with these credentials and region
  const stsClient = new STSClient({ region, credentials });

  // Call STS to get account ID
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));

  if (!identity.Account) {
    throw new Error('Could not retrieve AWS Account ID via STS');
  }

  return { account: identity.Account, region };
}

const main = async () => {
  const app = new App();

  try {
    const { account, region } = await getAccountIdAndRegion();

    new Ec2Stack(app, 'Ec2Stack', {
      env: { account, region },
    });

    app.synth();
  } catch (err) {
    console.error('Failed to retrieve AWS environment info:', err);
    process.exit(1);
  }
};

main();
