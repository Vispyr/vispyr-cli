import inquirer from 'inquirer';
import { p } from '../shared.js';
import chalk from 'chalk';

const message = `The following will be deployed to AWS:
- Vispyr Backend EC2 instance
- VispyrStack on CloudFormation
- CDKToolkit and CDK S3 bucket (if not already present)
- SSM Parameters for Vispyr Backend
- An Elastic IP + NAT Gateway
- Additional routes for VPC peering

Continue?`;

const confirmDeployment = async () => {
  const { confirmDeploy } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDeploy',
      message,
      default: false,
    },
  ]);
  p();

  if (!confirmDeploy) {
    p(chalk.yellow('Deployment cancelled'));
    process.exit(1);
  }
};

export default confirmDeployment;
