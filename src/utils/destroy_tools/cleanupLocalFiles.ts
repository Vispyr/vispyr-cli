import ora from 'ora';
import fs from 'fs-extra';

const cleanupLocalFiles = () => {
  const cleanupSpinner = ora('Cleaning up local files...').start();
  try {
    if (fs.existsSync('cdk.out')) fs.removeSync('cdk.out');
    if (fs.existsSync('cdk.context.json')) fs.removeSync('cdk.context.json');
    if (fs.existsSync('outputs.json')) fs.removeSync('outputs.json');
    if (fs.existsSync('.aws')) fs.removeSync('.aws');

    cleanupSpinner.succeed('Local files cleaned up');
  } catch (error) {
    cleanupSpinner.warn('Some local files could not be cleaned up');
  }
};

export default cleanupLocalFiles;
