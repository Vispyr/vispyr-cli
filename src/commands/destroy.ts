import chalk from 'chalk';
import { exec } from 'child_process';
import inquirer from 'inquirer';
import { promisify } from 'util';
import destroyCdkToolkit from '../utils/destroy_tools/destroyCdkToolkit.js';
import { p } from '../utils/shared.js';
import cleanupVpcPeeringRoutes from '../utils/destroy_tools/cleanupVpcPeeringRoutes.js';
import destroyVispyrStack from '../utils/destroy_tools/destroyVispyrStack.js';
import cleanupEIPs from '../utils/destroy_tools/cleanupEIPs.js';
import destroyS3Bucket from '../utils/destroy_tools/destroyS3Bucket.js';
import cleanupLocalFiles from '../utils/destroy_tools/cleanupLocalFiles.js';
import findEIPs from '../utils/destroy_tools/findEIPs.js';

const execAsync = promisify(exec);

const destroyBackend = async () => {
  try {
    p(chalk.blue.bold('\nVispyr Backend - Complete Teardown\n'));

    const { confirmTeardown } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmTeardown',
        message:
          'This will delete the Vispyr EC2 instance, VPC, NAT Gateway, Elastic IP, CDKToolkit stack, and bootstrap S3 bucket. Continue?',
        default: false,
      },
    ]);

    if (!confirmTeardown) {
      p(chalk.yellow('Teardown cancelled'));
      return;
    }

    await execAsync('npx cdk acknowledge 34892');
    await findEIPs();
    await cleanupVpcPeeringRoutes();
    await destroyVispyrStack();
    await cleanupEIPs();
    await destroyCdkToolkit(process.env.AWS_REGION as string);
    await destroyS3Bucket();
    cleanupLocalFiles();

    p(chalk.green.bold('\nComplete teardown finished!'));
  } catch (err) {
    console.error(chalk.red('\nAn error occurred during teardown:'), err);
    p(
      chalk.yellow(
        '\nPlease check your AWS console to manually clean up any remaining resources.'
      )
    );
    process.exit(1);
  }
};

export default destroyBackend;
