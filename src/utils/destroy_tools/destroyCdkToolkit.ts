import {
  CloudFormationClient,
  DescribeStacksCommand,
  DeleteStackCommand,
  UpdateTerminationProtectionCommand,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation';
import ora from 'ora';
import { p } from '../shared';
import chalk from 'chalk';

const destroyCdkToolkit = async (
  region: string,
  stackName: string = 'CDKToolkit'
) => {
  p(chalk.yellow('\nDestroying CDKToolkit...'));
  const otherCdkStacks = await checkForOtherCdkStacks(region);

  if (otherCdkStacks.length > 0) {
    p(
      `Skipping CDKToolkit deletion: Found ${
        otherCdkStacks.length
      } other CDK stack(s): ${otherCdkStacks.join(', ')}.`
    );
    return;
  }

  const client = new CloudFormationClient({ region });

  try {
    const describeStacksCommand = new DescribeStacksCommand({
      StackName: stackName,
    });
    const describeStacksResponse = await client.send(describeStacksCommand);
    const stack = describeStacksResponse.Stacks?.[0];

    if (stack?.EnableTerminationProtection) {
      p(`Disabling termination protection for ${stackName}...\n`);
      const updateTerminationProtectionCommand =
        new UpdateTerminationProtectionCommand({
          EnableTerminationProtection: false,
          StackName: stackName,
        });
      await client.send(updateTerminationProtectionCommand);
      p(`Termination protection disabled for ${stackName}.`);
    } else {
      p(`Termination protection is already disabled for ${stackName}.`);
    }

    const cloudFormationStack = ora(
      `Deleting CloudFormation stack: ${stackName} in ${region}...`
    ).start();
    const deleteStackCommand = new DeleteStackCommand({ StackName: stackName });

    await client.send(deleteStackCommand);
    cloudFormationStack.succeed('CDKToolkit stack deleted');
  } catch (error: any) {
    if (
      error.Code === 'ValidationError' &&
      error.message.includes('does not exist')
    ) {
      p(`CloudFormation stack ${stackName} not found in ${region}.`);
    } else {
      console.error(`Error deleting stack ${stackName}:`, error);
    }
  }
};

const checkForOtherCdkStacks = async (
  region: string,
  excludeStacks: string[] = ['CDKToolkit', 'VispyrStack']
): Promise<string[]> => {
  const client = new CloudFormationClient({ region });

  try {
    const command = new ListStacksCommand({
      StackStatusFilter: [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
        'IMPORT_COMPLETE',
        'IMPORT_ROLLBACK_COMPLETE',
      ],
    });

    const response = await client.send(command);
    const stacks = response.StackSummaries || [];

    const cdkStacks = stacks.filter((stack) => {
      const stackName = stack.StackName || '';

      if (excludeStacks.includes(stackName)) {
        return false;
      }

      return (
        stackName.includes('cdk') ||
        stackName.includes('Cdk') ||
        stackName.includes('CDK') ||
        false
      );
    });

    return cdkStacks.map((stack) => stack.StackName || '');
  } catch (error) {
    console.warn(`Warning: Could not check for other CDK stacks: ${error}`);
    return [];
  }
};

export default destroyCdkToolkit;
