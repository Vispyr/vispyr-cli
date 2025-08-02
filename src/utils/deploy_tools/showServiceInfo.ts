import chalk from 'chalk';
import { p } from '../shared';

const showServiceInfo = (httpsEndpoint: string): void => {
  p(chalk.blue.bold('\nDeployment Complete!\n'));
  p(chalk.green('Your observability stack is now running at:'));
  p(chalk.cyan.bold(`• Grafana (HTTPS): ${httpsEndpoint}`));

  p(chalk.yellow.bold('\nImportant Security Notice:'));
  p(chalk.yellow('This deployment uses a self-signed certificate.'));
  p(
    chalk.yellow(
      'Your browser will show security warnings that you need to accept.'
    )
  );
  p(
    chalk.yellow('This is normal and expected for self-signed certificates.\n')
  );

  p(chalk.blue('Next Steps:'));
  p(chalk.white('1. Open the Grafana UI:'), chalk.green(httpsEndpoint));
  p(
    chalk.white(
      '2. Accept the security warning for the self-signed certificate'
    )
  );
  p(chalk.white('3. Log in to Grafana'));
  p(chalk.white('   username:'), chalk.green('admin'));
  p(chalk.white('   password:'), chalk.green('admin'));
};

export default showServiceInfo;
