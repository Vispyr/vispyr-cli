import { promisify } from 'util';
import { exec } from 'child_process';
import chalk from 'chalk';

type Color =
  | 'red'
  | 'blue'
  | 'cyan'
  | 'yellow'
  | 'green'
  | 'gray'
  | 'blue bold';

export const execAsync = promisify(exec);

export const acknowledgeNotice = async (noticeId: number) => {
  try {
    await execAsync(`npx cdk acknowledge ${noticeId}`);
  } catch (error) {
    // Notice might not exist, continue
  }
};

export const styleLog = (color: Color, message: string) => {
  switch (color) {
    case 'red':
      return console.log(chalk.red(message));
    case 'blue':
      return console.log(chalk.blue(message));
    case 'cyan':
      return console.log(chalk.cyan(message));
    case 'yellow':
      return console.log(chalk.yellow(message));
    case 'green':
      return console.log(chalk.green(message));
    case 'gray':
      return console.log(chalk.gray(message));
    case 'blue bold':
      return console.log(chalk.blue.bold(message));
  }
};

export const p = console.log;
