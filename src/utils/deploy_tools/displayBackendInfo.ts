import chalk from 'chalk';
import path from 'path';
import { p } from '../shared.js';

const displayBackendInfo = (
  httpsEndpoint: string,
  domain: string,
  publicIp: string
): void => {
  if ((httpsEndpoint || domain) && publicIp) {
    p(chalk.blue.bold('\nDeployment Complete!\n'));

    if (!domain) displaySelfSignedNotice();

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
    p(chalk.yellow('    username:'), chalk.green('admin'));
    p(chalk.yellow('    password:'), chalk.green('admin'));

    p(chalk.white("4. See your application's telemetry data!"));
  } else {
    p(chalk.bgGreen('\nInfrastructure deployed successfully!'));
    p(chalk.yellow('Check your AWS console for the instance details.'));
  }
};

const displaySelfSignedNotice = () => {
  p(chalk.yellow.bold('Important Security Notice:'));
  p(chalk.yellow('This deployment uses a self-signed certificate.'));
  p(
    chalk.yellow(
      'Your browser will show security warnings that you need to accept.'
    )
  );
  p(
    chalk.yellow('This is normal and expected for self-signed certificates.\n')
  );
};

export default displayBackendInfo;
