import chalk from 'chalk';
import inquirer from 'inquirer';
import { p } from '../shared.js';

const message = `The following will be permanently deleted:
- Vispyr Backend EC2 Instance
- VispyrStack on CloudFormation
- CDKToolkit + CDK S3 Bucket (unless you have other stacks)
- S3 Bucket for traces
- SSM Parameters for Vispyr Backend
- Vispyr Elastic IP + NAT Gateway
- Routes used for VPC Peering connection
- Local files created by CLI deployment

Continue?`;

const confirmDestroy = async () => {
  const { confirmTeardown } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmTeardown',
      message,
      default: false,
    },
  ]);

  if (!confirmTeardown) {
    p(chalk.yellow('Teardown cancelled'));
    return;
  }
};

export default confirmDestroy;
