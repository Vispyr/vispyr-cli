import { spawn } from 'child_process';
import chalk from 'chalk';
import { p } from '../shared.js';

const destroyVispyrStack = async () => {
  p(chalk.yellow('\nDestroying Vispyr stack...'));

  try {
    const cdkDestroy = spawn(
      'npx',
      ['cdk', 'destroy', 'VispyrStack', '--force'],
      {
        stdio: 'inherit',
        env: { ...process.env },
      }
    );

    await new Promise<void>((res, rej) => {
      cdkDestroy.on('close', (code) => {
        if (code === 0) {
          p(chalk.green('Vispyr stack destroyed successfully\n'));
          res();
        } else {
          rej(new Error(`CDK destroy failed with code ${code}`));
        }
      });
    });
  } catch (error) {
    console.error(chalk.red('Failed to destroy Vispyr stack:'), error);
  }
};

export default destroyVispyrStack;
