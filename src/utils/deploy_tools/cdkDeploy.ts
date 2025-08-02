import ora from 'ora';
import { execAsync, p } from '../shared';
import { spawn } from 'child_process';
import chalk from 'chalk';

export const bootstrap = async () => {
  p(chalk.yellow('\nBootstrapping CDK (if needed)...'));
  const bootstrapSpinner = ora('Running CDK bootstrap...').start();
  try {
    await execAsync('npx cdk bootstrap');
    bootstrapSpinner.succeed('CDK bootstrapped successfully');
  } catch (error) {
    bootstrapSpinner.fail('CDK bootstrap failed');
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
};

export const deployInfrastructure = async () => {
  p(chalk.yellow('\nDeploying secure infrastructure...'));

  try {
    const cdkDeploy = spawn(
      'npx',
      [
        'cdk',
        'deploy',
        '--require-approval',
        'never',
        '--outputs-file',
        'outputs.json',
      ],
      {
        stdio: 'inherit',
        env: { ...process.env },
      }
    );

    await new Promise<void>((res, rej) => {
      cdkDeploy.on('close', (code) => {
        if (code === 0) {
          res();
        } else {
          rej(new Error(`CDK deploy failed with code ${code}`));
        }
      });
    });
  } catch (error) {
    console.error(chalk.red(error));
    process.exit(1);
  }
};
