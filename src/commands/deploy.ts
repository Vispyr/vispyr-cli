// import inquirer from 'inquirer';
import chalk from 'chalk';
// import ora from 'ora';

import { App } from 'aws-cdk-lib';
import { Ec2Stack } from '../../cdk/stacks/ec2-stack.js';

const deploy = async () => {
  try {
    const app = new App();

    new Ec2Stack(app, 'MyEc2Stack', {
      env: {
        region: 'test',
      },
    });
  } catch (err) {
    console.error(chalk.red('An error occurred:', err));
    process.exit(1);
  }
};

export default deploy;
