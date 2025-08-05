import { promisify } from 'util';
import { exec } from 'child_process';
import chalk from 'chalk';

export const execAsync = promisify(exec);

export const acknowledgeNotice = async () => {
  await execAsync(`npx cdk acknowledge 34892`);
};

export const sleep = async (ms: number) => {
  await new Promise((res) => setTimeout(res, ms));
};

export const p = console.log;

export const validateCredentials = () => {
  if (
    !(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION &&
      process.env.PEER_VPC_ID
    )
  ) {
    p(
      chalk.red('Missing variables in `.env`. See setup instructions for help')
    );
    process.exit(1);
  }
};
