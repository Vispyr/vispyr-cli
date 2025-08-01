import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { execAsync, styleLog } from '../shared';
import inquirer from 'inquirer';

const INFO = 'yellow';

interface DeploymentOutputs {
  instanceId?: string;
  publicIp?: string;
  privateIp?: string;
  httpsEndpoint?: string;
  peeringConnectionId?: string;
}

const outputsPath = path.resolve(process.cwd(), 'outputs.json');

export const getStackOutputs = async (): Promise<DeploymentOutputs> => {
  try {
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
        privateIp: stackOutputs.InstancePrivateIp,
        httpsEndpoint: stackOutputs.HTTPSEndpoint,
        peeringConnectionId: stackOutputs.PeeringConnectionId,
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

export const promptInstanceData = async (outputs: DeploymentOutputs) => {
  styleLog(INFO, '\nCould not automatically retrieve instance details.');
  const { instanceId, publicIp } = await inquirer.prompt([
    {
      type: 'input',
      name: 'instanceId',
      message: 'Enter the EC2 instance ID:',
      validate: (input) => input.trim().length > 0 || 'Instance ID is required',
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
  outputs.httpsEndpoint = `https://ec2-${publicIp.replace(/\./g, '-')}.${
    process.env.AWS_REGION
  }.compute.amazonaws.com`;
};
