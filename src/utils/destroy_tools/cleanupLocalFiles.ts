import ora from 'ora';
import fs from 'fs-extra';
import { sleep } from '../shared.js';

const cleanupLocalFiles = async () => {
  const cleanupSpinner = ora('Cleaning up local files...').start();
  await sleep(1000);

  try {
    if (fs.existsSync('cdk.out')) fs.removeSync('cdk.out');
    if (fs.existsSync('cdk.context.json')) fs.removeSync('cdk.context.json');

    cleanupSpinner.succeed('Local files cleaned up');
  } catch (error) {
    cleanupSpinner.warn('Some local files could not be cleaned up');
  }
};

export default cleanupLocalFiles;
