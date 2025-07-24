import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fromIni } from '@aws-sdk/credential-providers';
import { promisify } from 'util';
import init from './init.js';

const execAsync = promisify(exec);

const awsCredentialsPath = path.resolve(process.cwd(), '.aws/credentials');
const awsConfigPath = path.resolve(process.cwd(), '.aws/config');

const deploy = async () => {
  try {
    console.log(chalk.blue.bold('\nObservability Stack - Deployment\n'));

    const hasCredentials =
      fs.existsSync(awsCredentialsPath) && fs.existsSync(awsConfigPath);

    if (!hasCredentials) {
      console.log(chalk.yellow('AWS credentials not found. Starting init...'));
      await init(); // should probably rename
    }

    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message:
          'This will deploy an EC2 instance with 5 monitoring containers. Continue?',
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      console.log(chalk.yellow('Deployment cancelled'));
      return;
    }

    const credentials = await fromIni({
      filepath: awsCredentialsPath,
      configFilepath: awsConfigPath,
      profile: 'default',
    })();

    console.log(
      chalk.green('Using AWS credentials for:'),
      credentials.accessKeyId
    );

    console.log(chalk.yellow('\nGenerating CDK templates (if needed)...'));
    const synthSpinner = ora('Running CDK Synth...').start();
    try {
      await execAsync('npx cdk synth');
      synthSpinner.succeed('CDK templates successfully created');
    } catch (error) {
      synthSpinner.fail('CDK Synth failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    console.log(chalk.yellow('\nBootstrapping CDK (if needed)...'));
    const bootstrapSpinner = ora('Running CDK bootstrap...').start();
    try {
      await execAsync('npx cdk bootstrap');
      bootstrapSpinner.succeed('CDK bootstrapped successfully');
    } catch (error) {
      bootstrapSpinner.fail('CDK bootstrap failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    const spinner = ora('Deploying infrastructure using CDK...').start();
    try {
      const { stdout, stderr } = await execAsync(
        'npx cdk deploy --require-approval never'
      );
      spinner.succeed('Infrastructure deployed successfully');
      console.log(stdout);
      if (stderr) console.error(chalk.gray(stderr));
    } catch (error) {
      spinner.fail('Deployment failed');
      console.error(chalk.red(error));
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red('An error occurred:'), err);
    process.exit(1);
  }
};

export default deploy;
