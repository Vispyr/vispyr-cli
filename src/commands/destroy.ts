import chalk from 'chalk';
import destroyCdkToolkit from '../utils/destroy_tools/destroyCdkToolkit.js';
import cleanupVpcPeeringRoutes from '../utils/destroy_tools/cleanupVpcPeeringRoutes.js';
import destroyVispyrStack from '../utils/destroy_tools/destroyVispyrStack.js';
import cleanupEIPs from '../utils/destroy_tools/cleanupEIPs.js';
import destroyS3Bucket from '../utils/destroy_tools/destroyS3Bucket.js';
import cleanupLocalFiles from '../utils/destroy_tools/cleanupLocalFiles.js';
import findEIPs from '../utils/destroy_tools/findEIPs.js';
import confirmDestroy from '../utils/destroy_tools/confirmDestroy.js';
import { VispyrSSMManager } from '../utils/ssmService.js';
import { acknowledgeNotice, p } from '../utils/shared.js';

const destroyBackend = async () => {
  const ssmManager = new VispyrSSMManager();
  try {
    p(chalk.blue.bold('\nVispyr Backend - Complete Teardown\n'));

    await confirmDestroy();

    const params = await ssmManager.getDeploymentParameters();

    await acknowledgeNotice();
    await findEIPs();
    await cleanupVpcPeeringRoutes(params.peeringConnectionId);
    await destroyVispyrStack();
    await cleanupEIPs();
    await destroyCdkToolkit();
    await destroyS3Bucket();
    await ssmManager.deleteAllParameters();
    await cleanupLocalFiles();

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
