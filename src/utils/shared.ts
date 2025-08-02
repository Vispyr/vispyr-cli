import { promisify } from 'util';
import { exec } from 'child_process';

export const execAsync = promisify(exec);

export const acknowledgeNotice = async (noticeId: number) => {
  try {
    await execAsync(`npx cdk acknowledge ${noticeId}`);
  } catch (error) {
    // Notice might not exist, continue
  }
};

export const p = console.log;
