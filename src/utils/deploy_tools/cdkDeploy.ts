import ora from 'ora';
import { execAsync, p } from '../shared.js';
import { spawn } from 'child_process';
import chalk from 'chalk';

export const runCdkSynth = async () => {
  p();
  const synthSpinner = ora('Running CDK Synth...').start();

  try {
    await execAsync('npx cdk synth');
    synthSpinner.succeed('CDK templates successfully created');
  } catch (error) {
    synthSpinner.fail('CDK Synth failed');
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
};

export const bootstrap = async () => {
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
  p(chalk.yellow('\nDeploying Vispyr infrastructure...'));

  try {
    const cdkDeploy = spawn(
      'npx',
      ['cdk', 'deploy', '--require-approval', 'never'],
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
