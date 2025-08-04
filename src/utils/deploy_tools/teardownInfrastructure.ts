import chalk from 'chalk';
import { p } from '../shared.js';
import destroyVispyrStack from '../destroy_tools/destroyVispyrStack.js';
import destroyCdkToolkit from '../destroy_tools/destroyCdkToolkit.js';
import destroyS3Bucket from '../destroy_tools/destroyS3Bucket.js';

const teardownInfrastructure = async (): Promise<void> => {
  try {
    p(chalk.yellow('\nTearing down infrastructure...'));

    await destroyVispyrStack();
    await destroyCdkToolkit();
    await destroyS3Bucket();

    p(chalk.green('Infrastructure torn down successfully'));
  } catch (error) {
    console.error(chalk.red('Failed to tear down infrastructure:'), error);
  }
};

export default teardownInfrastructure;
