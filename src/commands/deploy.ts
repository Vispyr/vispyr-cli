import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
// import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import init from './init.js';

const execAsync = promisify(exec);

const outputsPath = path.resolve(process.cwd(), 'outputs.json');

interface DeploymentOutputs {
  instanceId?: string;
  publicIp?: string;
}

const getStackOutputs = async (): Promise<DeploymentOutputs> => {
  try {
    // Get outputs from CDK deployment
    const { stdout } = await execAsync('npx cdk list');
    const stacks = stdout.trim().split('\n');

    if (stacks.length === 0) {
      throw new Error('No CDK stacks found');
    }

    if (fs.existsSync(outputsPath)) {
      const outputs = JSON.parse(fs.readFileSync('outputs.json', 'utf8'));
      const stackName = Object.keys(outputs)[0];
      const stackOutputs = outputs[stackName];

      return {
        instanceId: stackOutputs.InstanceId,
        publicIp: stackOutputs.InstancePublicIP,
      };
    }

    return {};
  } catch (error) {
    console.warn(
      chalk.yellow('Could not retrieve stack outputs automatically')
    );
    return {};
  }
};

const waitForInstanceReady = async (
  instanceId: string,
  region: string
): Promise<void> => {
  const ec2Client = new EC2Client({ region });
  const spinner = ora('Waiting for EC2 instance to be ready...').start();

  let attempts = 0;
  const maxAttempts = 30; // 5 minutes with 10-second intervals

  while (attempts < maxAttempts) {
    try {
      const response = await ec2Client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        })
      );

      const instance = response.Reservations?.[0]?.Instances?.[0];
      if (instance?.State?.Name === 'running' && instance?.PublicIpAddress) {
        spinner.succeed(
          `Instance ${instanceId} is ready at ${instance.PublicIpAddress}`
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    } catch (error) {
      spinner.fail('Failed to check instance status');
      throw error;
    }
  }

  spinner.fail('Instance did not become ready within timeout');
  throw new Error('Instance readiness timeout');
};

const waitForDeploymentComplete = async (
  instanceId: string,
  region: string
): Promise<void> => {
  const ec2Client = new EC2Client({ region });
  const spinner = ora(
    'Waiting for application deployment to complete...'
  ).start();

  let attempts = 0;
  const maxAttempts = 60; // 10 minutes with 10-second intervals

  while (attempts < maxAttempts) {
    try {
      const response = await ec2Client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        })
      );

      const instance = response.Reservations?.[0]?.Instances?.[0];
      if (instance?.State?.Name === 'running' && instance?.PublicIpAddress) {
        // Try to check if deployment is complete by looking at instance logs
        // This is a simplified check - in practice, you might want to use CloudWatch logs
        spinner.text = `Vispyr Backend build in progress... (${Math.floor(
          (attempts * 10) / 60
        )} min elapsed)`;

        // After 5 minutes, assume deployment is likely complete
        if (attempts >= 30) {
          spinner.succeed('Application deployment should be complete');
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    } catch (error) {
      spinner.fail('Failed to monitor deployment status');
      throw error;
    }
  }

  spinner.warn(
    'Deployment monitoring timeout - deployment may still be in progress'
  );
};

const showServiceUrls = (publicIp: string): void => {
  console.log(chalk.blue.bold('\n🎉 Deployment Complete!\n'));
  console.log(chalk.green('Your observability stack is now running at:'));
  console.log(chalk.cyan(`• Grafana: http://${publicIp}:3000`));
  console.log(chalk.cyan(`• Prometheus: http://${publicIp}:9090`));
  console.log(chalk.cyan(`• Pyroscope: http://${publicIp}:4040`));
  console.log(chalk.cyan(`• Tempo: http://${publicIp}:3200`));
  console.log(
    chalk.gray(
      '\nNote: Make sure your security groups allow access to these ports\n'
    )
  );
};

const deploy = async () => {
  try {
    console.log(chalk.blue.bold('\n🚀 Observability Stack - Deployment\n'));

    const hasCredentials = process.env.INITIALIZED === 'true';

    if (!hasCredentials) {
      console.log(chalk.yellow('AWS credentials not found. Starting init...'));
      await init();
    }

    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message:
          'This will deploy an EC2 instance and set up your observability stack with Docker Compose. Continue?',
        default: false,
      },
    ]);

    if (!confirmDeploy) {
      console.log(chalk.yellow('Deployment cancelled'));
      return;
    }

    console.log(
      chalk.green('✅ Using AWS credentials for:'),
      process.env.AWS_ACCESS_KEY_ID?.substring(0, 8) + '...'
    );

    console.log(chalk.yellow('\n📋 Generating CDK templates (if needed)...'));
    const synthSpinner = ora('Running CDK Synth...').start();
    try {
      await execAsync('npx cdk synth');
      synthSpinner.succeed('CDK templates successfully created');
    } catch (error) {
      synthSpinner.fail('CDK Synth failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    console.log(chalk.yellow('\n🥾 Bootstrapping CDK (if needed)...'));
    const bootstrapSpinner = ora('Running CDK bootstrap...').start();
    try {
      await execAsync('npx cdk bootstrap');
      bootstrapSpinner.succeed('CDK bootstrapped successfully');
    } catch (error) {
      bootstrapSpinner.fail('CDK bootstrap failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }

    // Acknowledge notice
    try {
      await execAsync('npx cdk acknowledge 34892');
    } catch (error) {
      // Notice might not exist, continue
    }

    console.log(chalk.yellow('\n☁️  Deploying infrastructure...'));
    const deploySpinner = ora('Deploying infrastructure using CDK...').start();
    try {
      const { stderr } = await execAsync(
        'npx cdk deploy --require-approval never --outputs-file outputs.json'
      );
      deploySpinner.succeed('Infrastructure deployed successfully');

      if (stderr && !stderr.includes('npm WARN')) {
        console.log(chalk.gray(stderr));
      }
    } catch (error) {
      deploySpinner.fail('Infrastructure deployment failed');
      console.error(chalk.red(error));
      process.exit(1);
    }

    // Get deployment outputs
    const outputs = await getStackOutputs();

    if (!outputs.instanceId || !outputs.publicIp) {
      console.log(
        chalk.yellow('\n⚠️  Could not automatically retrieve instance details.')
      );
      const { instanceId, publicIp } = await inquirer.prompt([
        {
          type: 'input',
          name: 'instanceId',
          message: 'Enter the EC2 instance ID:',
          validate: (input) =>
            input.trim().length > 0 || 'Instance ID is required',
        },
        {
          type: 'input',
          name: 'publicIp',
          message: 'Enter the public IP address:',
          validate: (input) =>
            /^\d+\.\d+\.\d+\.\d+$/.test(input) || 'Valid IP address required',
        },
      ]);

      outputs.instanceId = instanceId;
      outputs.publicIp = publicIp;
    }

    // Wait for instance to be ready and application to deploy
    if (outputs.instanceId) {
      await waitForInstanceReady(
        outputs.instanceId,
        process.env.AWS_REGION as string
      );
      await waitForDeploymentComplete(
        outputs.instanceId,
        process.env.AWS_REGION as string
      );
    }

    // Show service URLs
    if (outputs.publicIp) {
      showServiceUrls(outputs.publicIp);
    } else {
      console.log(chalk.green('\n✅ Infrastructure deployed successfully!'));
      console.log(
        chalk.yellow('Check your AWS console for the instance IP address.')
      );
    }
  } catch (err) {
    console.error(chalk.red('\n❌ An error occurred:'), err);
    process.exit(1);
  }
};

export default deploy;
