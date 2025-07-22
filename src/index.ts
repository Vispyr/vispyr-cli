#!/usr/bin/env node

import { Command } from 'commander';
import figlet from 'figlet';
import inquirer from 'inquirer';
import chalk from 'chalk';

console.log(chalk.redBright(figlet.textSync('Vispyr')));

const program = new Command();

program
  .version('1.0.0')
  .name('vispyr-cli')
  .description('A CLI application built with Commander.js')
  .option('-d, --debug', 'Output extra debugging information')
  .option('-l, --ls [value]', 'List directory contents')
  .option('-m, --mkdir <value>', 'Create a directory')
  .option('-t, --touch <value>', 'Create a file');

program
  .command('list')
  .description('List all items')
  .action(() => {
    console.log('Listing items...');
  });

program
  .command('create')
  .description('Creates an item')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter the item name:',
        validate: (input) =>
          input.length >= 3
            ? true
            : 'The name must be at least 3 characters long.',
      },
      {
        type: 'list',
        name: 'type',
        message: 'Select the item type:',
        choices: ['default', 'special', 'custom'],
      },
    ]);

    console.log(
      chalk.green(
        `Successfully created item "${answers.name}" of type "${answers.type}"`
      )
    );
  });

program.parse();

const options = program.opts();
if (options.debug) {
  console.log('Debug mode is enabled');
  console.log('Options:', options);
}
