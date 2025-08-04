import { promisify } from 'util';
import { exec } from 'child_process';

export const execAsync = promisify(exec);

export const acknowledgeNotice = async () => {
  await execAsync(`npx cdk acknowledge 34892`);
};

export const sleep = async (ms: number) => {
  await new Promise((res) => setTimeout(res, ms));
};

export const p = console.log;
