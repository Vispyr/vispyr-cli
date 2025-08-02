import { spawn } from 'child_process';
import { p } from '../shared';
import chalk from 'chalk';

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
          p(chalk.green('Vispyr stack destroyed successfully'));
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
