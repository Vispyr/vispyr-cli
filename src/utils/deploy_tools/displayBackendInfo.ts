import chalk from 'chalk';
import path from 'path';
import { p } from '../shared.js';

const showBackendInfo = (
  httpsEndpoint: string,
  domain: string,
  publicIp: string
): void => {
  if ((httpsEndpoint || domain) && publicIp) {
    p(chalk.blue.bold('\nDeployment Complete!\n'));

    p(chalk.blue('Next Steps:'));
    p(
      chalk.white('1. Deploy your application with Vispyr Agent:'),
      chalk.green(path.resolve(process.cwd(), 'vispyr_agent'))
    );

    p(
      chalk.white('2. Open the Grafana UI:'),
      chalk.green(domain ? `https://vispyr.${domain}` : httpsEndpoint)
    );

    p(chalk.white('3. Log in to Grafana'));
    p(chalk.yellow('     username:'), chalk.green('admin'));
    p(chalk.yellow('     password:'), chalk.green('admin'));

    p(chalk.white("4. See your application's telemetry data!"));
  } else {
    p(chalk.bgGreen('\nInfrastructure deployed successfully!'));
    p(chalk.yellow('Check your AWS console for the instance details.'));
  }
};

export default showBackendInfo;
