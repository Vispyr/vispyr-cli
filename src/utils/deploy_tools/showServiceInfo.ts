import chalk from 'chalk';

const showServiceInfo = (httpsEndpoint: string): void => {
  console.log(chalk.blue.bold('\nDeployment Complete!\n'));
  console.log(chalk.green('Your observability stack is now running at:'));
  console.log(chalk.cyan.bold(`• Grafana (HTTPS): ${httpsEndpoint}`));

  console.log(chalk.yellow.bold('\nImportant Security Notice:'));
  console.log(chalk.yellow('This deployment uses a self-signed certificate.'));
  console.log(
    chalk.yellow(
      'Your browser will show security warnings that you need to accept.'
    )
  );
  console.log(
    chalk.yellow('This is normal and expected for self-signed certificates.\n')
  );

  console.log(chalk.blue('Next Steps:'));
  console.log(
    chalk.white('1. Open the Grafana UI:'),
    chalk.green(httpsEndpoint)
  );
  console.log(
    chalk.white(
      '2. Accept the security warning for the self-signed certificate'
    )
  );
  console.log(chalk.white('3. Log in to Grafana'));
  console.log(chalk.white('   username:'), chalk.green('admin'));
  console.log(chalk.white('   password:'), chalk.green('admin'));
};

export default showServiceInfo;
