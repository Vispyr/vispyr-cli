#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';

import destroyBackend from './commands/destroy.js';
import deployBackend from './commands/deploy.js';
import logo from './utils/logo.js';

console.clear();
console.log(chalk.redBright(logo));
console.log('');

const program = new Command();

program
  .version('1.0.0')
  .name('vispyr-cli')
  .description('Command Line Tool used to deploy Vispyr Backend to AWS');

program
  .command('deploy')
  .description('Deploys AWS infrastructure')
  .action(deployBackend);

program
  .command('destroy')
  .description('Destroy AWS infrastructure')
  .action(destroyBackend);

program.parse();
