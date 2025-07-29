#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import figlet from 'figlet';
import chalk from 'chalk';

import deploy from './commands/deploy.js';
import destroy from './commands/destroy.js';
import deployAgent from './commands/deploy-agent.js';
import destroyAgent from './commands/destroy-agent.js';

console.log(chalk.redBright(figlet.textSync('Vispyr')));
console.log('');

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
  .command('deploy')
  .description('Deploys AWS architecture')
  .action(deploy);

program
  .command('destroy')
  .description('Destroy AWS architecture')
  .action(destroy);

program
  .command('deploy-agent')
  .description('Adds agent to EC2 instance')
  .action(deployAgent);

program
  .command('destroy-agent')
  .description('Removes agent from EC2 instance')
  .action(destroyAgent);

program.parse();

const options = program.opts();
if (options.debug) {
  console.log('Debug mode is enabled');
  console.log('Options:', options);
}
