import { input, select } from '@inquirer/prompts';
import ora from 'ora';
import { exportEnvironment } from '../utils/config.js';

const awsRegions = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'af-south-1',
  'ap-east-1',
  'ap-south-2',
  'ap-southeast-3',
  'ap-southeast-5',
  'ap-southeast-4',
  'ap-south-1',
  'ap-northeast-3',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-7',
  'ap-northeast-1',
  'ca-central-1',
  'ca-west-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-west-3',
  'eu-south-2',
  'eu-north-1',
  'eu-central-2',
  'il-central-1',
  'mx-central-1',
  'me-south-1',
  'me-central-1',
  'sa-east-1',
];

export const init = async () => {
  const accessKeyId = await input({ message: 'AWS Access Key ID:' });
  const secretAccessKey = await input({ message: 'AWS Secret Access Key:' });
  const region = await select({
    message: 'AWS Region:',
    choices: awsRegions,
  });

  const config = {
    aws_access_key_id: accessKeyId,
    aws_secret_access_key: secretAccessKey,
    aws_region: region,
    initialized: true,
  };

  const spinner = ora({
    text: 'Saving AWS Credentials...',
    color: 'red',
    spinner: 'bouncingBall',
  }).start();

  exportEnvironment(config);

  await new Promise((res) => setTimeout(res, 3000));
  if (true) {
    spinner.succeed(`AWS credentials saved!`);
  } else {
    spinner.fail('AWS Credentials could not be saved');
    process.exit(1);
  }
};

export default init;
