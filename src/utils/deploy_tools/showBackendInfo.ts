import chalk from 'chalk';
import path from 'path';
import { p } from '../shared.js';

const showBackendInfo = (httpsEndpoint: string, publicIp: string): void => {
  if (httpsEndpoint && publicIp) {
    p(chalk.blue.bold('\nDeployment Complete!'));

    p(chalk.yellow.bold('\nImportant Security Notice:'));
    p(chalk.yellow('This deployment uses a self-signed certificate.'));
    p(
      chalk.yellow(
        'Your browser will show security warnings that you need to accept.'
      )
    );
    p(
      chalk.yellow(
        'This is normal and expected for self-signed certificates.\n'
      )
    );

    p(chalk.blue('Next Steps:'));
    p(chalk.white('1. Deploy your application with Vispyr Agent'));
    p(
      chalk.yellow(' Agent location:'),
      chalk.green(path.resolve(process.cwd(), 'vispyr_agent'))
    );

    p(chalk.white('2. Open the Grafana UI:'), chalk.green(httpsEndpoint));

    p(
      chalk.white(
        '3. Accept the security warning for the self-signed certificate'
      )
    );

    p(chalk.white('4. Log in to Grafana'));
    p(chalk.yellow(' username:'), chalk.green('admin'));
    p(chalk.yellow(' password:'), chalk.green('admin'));

    p(chalk.white("5. See your application's telemetry data!"));
  } else {
    p(chalk.bgGreen('\nInfrastructure deployed successfully!'));
    p(chalk.yellow('Check your AWS console for the instance details.'));
  }
};

export default showBackendInfo;
