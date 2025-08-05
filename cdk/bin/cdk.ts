import { App } from 'aws-cdk-lib';
import { VispyrBackend } from '../stacks/vispyrStack.js';
import process from 'process';

const main = async () => {
  const app = new App();

  try {
    const account = process.env.CDK_DEFAULT_ACCOUNT;
    const region = process.env.CDK_DEFAULT_REGION;
    const peerVpcId = process.env.PEER_VPC_ID;
    const domain = process.env.VISPYR_DOMAIN;
    const email = process.env.VISPYR_EMAIL;

    if (!peerVpcId) {
      console.error('PEER_VPC_ID is required but not found in .env file');
      console.error('Please add PEER_VPC_ID=vpc-xxxxxxxxx to your .env file');
      process.exit(1);
    }

    if (!peerVpcId.match(/^vpc-[a-z0-9]{8,17}$/)) {
      console.error(`Invalid PEER_VPC_ID format: ${peerVpcId}`);
      console.error('Expected format: vpc-xxxxxxxxx');
      process.exit(1);
    }

    new VispyrBackend(app, 'VispyrStack', {
      env: { account, region },
      peerVpcId,
      domain,
      email,
    });

    app.synth();
  } catch (err) {
    console.error('Failed to retrieve AWS environment info:', err);
    process.exit(1);
  }
};

main();
