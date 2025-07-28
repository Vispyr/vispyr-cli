import chalk from 'chalk';
import { exec } from 'child_process';
import inquirer from 'inquirer';
import ora from 'ora';
import { promisify } from 'util';
import fs from 'fs-extra';

const execAsync = promisify(exec);

const deployDemo = async () => {
  try {
    console.log(chalk.blue.bold('\n🚀 Vispyr Demo Deployment\n'));
    console.log(
      chalk.gray(
        'This will deploy both the Vispyr backend and demo app in separate VPCs\n'
      )
    );

    // Check for required environment variables
    if (!process.env.PERSONAL_ACCESS_TOKEN) {
      console.error(
        chalk.red('❌ PERSONAL_ACCESS_TOKEN environment variable is required')
      );
      process.exit(1);
    }

    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: 'Deploy both Vispyr backend (Grafana) and demo app (Node.js)?',
        default: true,
      },
    ]);

    if (!confirmDeploy) {
      console.log(chalk.yellow('Deployment cancelled'));
      return;
    }

    // Acknowledge CDK notice (ignore if it doesn't exist)
    try {
      await execAsync('npx cdk acknowledge 34892');
    } catch (error) {
      // Notice might not exist, continue
    }

    // 1. Bootstrap CDK (if needed)
    const bootstrapSpinner = ora('Bootstrapping CDK environment...').start();
    try {
      const { stdout, stderr } = await execAsync(`npx cdk bootstrap`);
      bootstrapSpinner.succeed('CDK bootstrap complete');

      if (stdout) console.log(chalk.gray(stdout));
      if (stderr && !stderr.includes('npm WARN')) {
        console.log(chalk.gray(stderr));
      }
    } catch (error) {
      bootstrapSpinner.fail('CDK bootstrap failed');
      console.error(chalk.red('\n❌ Bootstrap error:'), error);
      console.log(chalk.yellow('\n💡 Try running manually: npx cdk bootstrap'));
      throw error;
    }

    // 2. Deploy Vispyr Backend (Ec2Stack)
    const backendSpinner = ora(
      'Deploying Vispyr backend (Grafana observability stack)...'
    ).start();
    try {
      const { stdout: backendOutput } = await execAsync(
        'npx cdk deploy Ec2Stack --require-approval never --outputs-file backend-outputs.json'
      );
      backendSpinner.succeed('Vispyr backend deployed successfully');

      if (backendOutput) {
        console.log(chalk.gray(backendOutput));
      }
    } catch (error) {
      backendSpinner.fail('Failed to deploy Vispyr backend');
      console.error(chalk.red(error));
      throw error;
    }

    // 3. Deploy Demo App (DemoStack)
    const demoSpinner = ora(
      'Deploying demo app (Node.js with PostgreSQL)...'
    ).start();
    try {
      const { stdout: demoOutput } = await execAsync(
        'npx cdk deploy DemoStack --require-approval never --outputs-file demo-outputs.json'
      );
      demoSpinner.succeed('Demo app deployed successfully');

      if (demoOutput) {
        console.log(chalk.gray(demoOutput));
      }
    } catch (error) {
      demoSpinner.fail('Failed to deploy demo app');
      console.error(chalk.red(error));
      throw error;
    }

    // 4. Read and display outputs
    const outputSpinner = ora('Reading deployment outputs...').start();
    try {
      let backendOutputs: any = {};
      let demoOutputs: any = {};

      if (fs.existsSync('backend-outputs.json')) {
        backendOutputs = JSON.parse(
          fs.readFileSync('backend-outputs.json', 'utf8')
        );
      }

      if (fs.existsSync('demo-outputs.json')) {
        demoOutputs = JSON.parse(fs.readFileSync('demo-outputs.json', 'utf8'));
      }

      outputSpinner.succeed('Deployment outputs retrieved');

      // Display results
      console.log(
        chalk.green.bold('\n✅ Demo deployment completed successfully!\n')
      );

      // Backend outputs
      console.log(chalk.cyan.bold('🔧 Vispyr Backend (Grafana):'));
      if (backendOutputs['Ec2Stack']) {
        const backend = backendOutputs['Ec2Stack'];
        if (backend.HTTPSEndpoint) {
          console.log(
            chalk.white(`   📊 Grafana URL: ${backend.HTTPSEndpoint}`)
          );
        }
        if (backend.InstancePublicIP) {
          console.log(
            chalk.white(`   🖥️  Instance IP: ${backend.InstancePublicIP}`)
          );
        }
        if (backend.InstanceId) {
          console.log(chalk.white(`   🆔 Instance ID: ${backend.InstanceId}`));
        }
      }

      console.log('');

      // Demo app outputs
      console.log(chalk.magenta.bold('🎯 Demo App (Node.js):'));
      if (demoOutputs['DemoStack']) {
        const demo = demoOutputs['DemoStack'];
        if (demo.AppURL) {
          console.log(chalk.white(`   🌐 App URL: ${demo.AppURL}`));
        }
        if (demo.InstancePublicIP) {
          console.log(
            chalk.white(`   🖥️  Instance IP: ${demo.InstancePublicIP}`)
          );
        }
        if (demo.InstanceId) {
          console.log(chalk.white(`   🆔 Instance ID: ${demo.InstanceId}`));
        }
      }

      console.log('');
      console.log(chalk.yellow('📝 Notes:'));
      console.log(
        chalk.gray('   • Both applications are deployed in separate VPCs')
      );
      console.log(
        chalk.gray('   • Grafana uses HTTPS with self-signed certificate')
      );
      console.log(chalk.gray('   • Demo app uses HTTP on port 3001'));
      console.log(
        chalk.gray(
          '   • It may take a few minutes for applications to fully start'
        )
      );
      console.log(
        chalk.gray('   • Use `vispyr-cli destroy` to clean up all resources\n')
      );
    } catch (error) {
      outputSpinner.warn(
        'Could not read deployment outputs - check AWS console for details'
      );
    }
  } catch (err) {
    console.error(chalk.red('\n❌ Demo deployment failed:'), err);
    console.log(
      chalk.yellow(
        '\n⚠️  Some resources may have been created. Run `vispyr-cli destroy` to clean up.'
      )
    );
    process.exit(1);
  }
};

export default deployDemo;
