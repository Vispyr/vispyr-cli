import {
  CloudFormationClient,
  DescribeStacksCommand,
  DeleteStackCommand,
  UpdateTerminationProtectionCommand,
} from '@aws-sdk/client-cloudformation'; // Importing necessary commands

async function destroyCdkToolkit(
  region: string,
  stackName: string = 'CDKToolkit'
) {
  const client = new CloudFormationClient({ region }); // Creating a CloudFormation client

  try {
    // Check if termination protection is enabled
    const describeStacksCommand = new DescribeStacksCommand({
      StackName: stackName,
    }); // Creating a command to describe stacks
    const describeStacksResponse = await client.send(describeStacksCommand); // Sending the command to AWS
    const stack = describeStacksResponse.Stacks?.[0]; // Accessing stack details

    if (stack?.EnableTerminationProtection) {
      console.log(`Disabling termination protection for ${stackName}...`);
      const updateTerminationProtectionCommand =
        new UpdateTerminationProtectionCommand({
          EnableTerminationProtection: false,
          StackName: stackName,
        });
      await client.send(updateTerminationProtectionCommand); // Sending the command to AWS to update termination protection
      console.log(`Termination protection disabled for ${stackName}.`);
    } else {
      console.log(
        `Termination protection is already disabled for ${stackName}.`
      );
    }

    // Delete the stack
    console.log(`Deleting CloudFormation stack: ${stackName} in ${region}...`);
    const deleteStackCommand = new DeleteStackCommand({ StackName: stackName }); // Creating a command to delete the stack
    await client.send(deleteStackCommand); // Sending the command to AWS
    console.log(
      `Stack deletion initiated for ${stackName}. You can monitor its progress in the CloudFormation console.`
    );
  } catch (error: any) {
    // Catching errors from AWS SDK
    if (
      error.Code === 'ValidationError' &&
      error.message.includes('does not exist')
    ) {
      // Handling cases where the stack doesn't exist
      console.log(`CloudFormation stack ${stackName} not found in ${region}.`);
    } else {
      console.error(`Error deleting stack ${stackName}:`, error);
    }
  }
}

export default destroyCdkToolkit;
