import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

const awsRegions = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'ca-west-1',
];

const deploy = async () => {
  try {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'What is your name?',
      },
      {
        type: 'list',
        name: 'region',
        message: 'In which region would you like to deploy?',
        choices: awsRegions,
      },
    ]);

    const spinner = ora({
      text: 'Deploying the AWS architecture...',
      color: 'red',
      spinner: 'bouncingBall',
    }).start();

    await new Promise((res) => setTimeout(res, 3000));

    const code = 0; // Will be set by CDK

    if (code === 0) {
      spinner.succeed(
        chalk.green(
          `${answers.name} successfully deployed to ${answers.region}!`
        )
      );
    } else {
      spinner.fail(chalk.red(`❌ CDK deploy failed with exit code ${code}`));
      process.exit(code);
    }
  } catch (err) {
    console.error(chalk.red('An error occurred:', err));
    process.exit(1);
  }
};

export default deploy;
