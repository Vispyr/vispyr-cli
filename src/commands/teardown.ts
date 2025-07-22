import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

// Need to improve - use deploy as a reference

const teardown = async () => {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'What is your name?',
    },
  ]);

  const spinner = ora({
    text: 'Tearing down the AWS architecture...',
    color: 'red',
    spinner: 'bouncingBall',
  }).start();

  await new Promise((res) => setTimeout(res, 3000));

  spinner.succeed(chalk.green(`${answers.name} successfully burned down AWS!`));
};

export default teardown;
