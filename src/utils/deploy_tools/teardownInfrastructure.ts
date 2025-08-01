import chalk from 'chalk';
import ora from 'ora';
import { execAsync } from '../shared';

const teardownInfrastructure = async (): Promise<void> => {
  try {
    console.log(chalk.yellow('\n🧹 Tearing down infrastructure...'));
    const destroySpinner = ora('Running CDK destroy...').start();

    await execAsync('npx cdk destroy --force');

    destroySpinner.succeed('Infrastructure torn down successfully');
  } catch (error) {
    console.error(chalk.red('Failed to tear down infrastructure:'), error);
  }
};

export default teardownInfrastructure;
