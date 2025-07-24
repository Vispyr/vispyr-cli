import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { fromIni } from '@aws-sdk/credential-providers';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import path from 'path';
import process from 'process';

// Utility to load AWS account and region
async function getAwsEnv(profile = 'default') {
  const credentials = fromIni({
    profile,
    filepath: path.resolve(process.env.HOME || '', '.aws/credentials'),
    configFilepath: path.resolve(process.env.HOME || '', '.aws/config'),
  });

  const region = process.env.AWS_REGION || 'us-east-2';

  const stsClient = new STSClient({ region, credentials });
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));

  if (!identity.Account) {
    throw new Error('Could not determine AWS account');
  }

  return { accountId: identity.Account, region, credentials };
}

async function teardown(stackName: string, profile = 'default') {
  const { region, credentials } = await getAwsEnv(profile);

  const cfnClient = new CloudFormationClient({ region, credentials });

  try {
    const describe = await cfnClient.send(
      new DescribeStacksCommand({ StackName: stackName })
    );
    if (!describe.Stacks || describe.Stacks.length === 0) {
      console.log(
        `Stack "${stackName}" does not exist or has already been deleted.`
      );
      return;
    }
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      console.log(
        `Stack "${stackName}" does not exist or has already been deleted.`
      );
      return;
    } else {
      throw err;
    }
  }

  console.log(`Deleting stack "${stackName}"...`);
  await cfnClient.send(new DeleteStackCommand({ StackName: stackName }));

  console.log(`Waiting for "${stackName}" to be deleted...`);
  // Wait loop (poll every 10 seconds until deleted)
  let stackExists = true;
  while (stackExists) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 10000)); // 10s delay
      await cfnClient.send(new DescribeStacksCommand({ StackName: stackName }));
    } catch (err: any) {
      if (err.name === 'ValidationError') {
        stackExists = false;
      } else {
        throw err;
      }
    }
  }

  console.log(`✅ Stack "${stackName}" deleted.`);
}

export default teardown;
