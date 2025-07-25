import { App } from 'aws-cdk-lib';
import { Ec2Stack } from '../stacks/ec2-stack.js';
import process from 'process';

const main = async () => {
  const app = new App();

  try {
    const account = process.env.CDK_DEFAULT_ACCOUNT;
    const region = process.env.CDK_DEFAULT_REGION;

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
