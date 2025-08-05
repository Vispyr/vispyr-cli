import chalk from 'chalk';
import { p } from '../shared.js';
import inquirer from 'inquirer';

const displayCertbotInstructions = async (publicIp: string, domain: string) => {
  p();
  p(chalk.blue('Connect your domain to Vispyr:'));
  p(chalk.white('1. Log in to your domain registrar'));
  p(chalk.white('2. Edit DNS settings for'), chalk.green(domain));
  p(chalk.white('3. Set a new A Record:'));
  p(chalk.yellow('     Host:'), chalk.green('vispyr'));
  p(chalk.yellow('     Value:'), chalk.green(publicIp));
  p();

  await inquirer.prompt([
    {
      type: 'input',
      name: 'setARecord',
      message: 'Press [Enter] when A Record has been set to continue',
      default: '',
    },
  ]);
};

export default displayCertbotInstructions;
