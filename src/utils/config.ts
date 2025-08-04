import chalk from 'chalk';
import { AWSConfigType, Region } from '../types.js';
import { p } from './shared.js';
import init from '../commands/init.js';

export const exportEnvironment = (config: AWSConfigType) => {
  process.env.AWS_ACCESS_KEY_ID = config.aws_access_key_id;
  process.env.AWS_SECRET_ACCESS_KEY = config.aws_secret_access_key;
  process.env.AWS_REGION = config.aws_region as Region;
};

export const validateCredentials = async () => {
  if (!hasCredentials()) {
    p(chalk.yellow('AWS credentials not found. Starting init...'));
    await init();
  }
};

const hasCredentials = () => {
  return (
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );
};
