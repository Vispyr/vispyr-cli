import {
  SSMClient,
  GetParametersCommand,
  GetParameterCommand,
  DeleteParametersCommand,
  GetParametersByPathCommand,
  Parameter,
} from '@aws-sdk/client-ssm';
import ora from 'ora';
import { sleep } from './shared.js';

export interface VispyrDeploymentParams {
  instanceId: string;
  publicIp: string;
  privateIp: string;
  httpsEndpoint: string;
  peeringConnectionId: string;
  vpcId: string;
  deploymentTimestamp: string;
}

export class VispyrSSMManager {
  private ssmClient: SSMClient;
  private parameterPrefix = '/vispyr/backend';

  constructor(region?: string) {
    this.ssmClient = new SSMClient({ region });
  }

  async getDeploymentParameters(): Promise<VispyrDeploymentParams> {
    const paramSpinner = ora('Fetching Vispyr SSM Parameters').start();
    await sleep(1000);

    try {
      const parameterNames = [
        `${this.parameterPrefix}/instance-id`,
        `${this.parameterPrefix}/public-ip`,
        `${this.parameterPrefix}/private-ip`,
        `${this.parameterPrefix}/https-endpoint`,
        `${this.parameterPrefix}/peering-connection-id`,
        `${this.parameterPrefix}/vpc-id`,
        `${this.parameterPrefix}/deployment-timestamp`,
      ];

      const command = new GetParametersCommand({
        Names: parameterNames,
        WithDecryption: false,
      });

      const result = await this.ssmClient.send(command);

      if (!result.Parameters || result.Parameters.length === 0) {
        throw new Error('No Vispyr deployment parameters found');
      }

      if (result.InvalidParameters && result.InvalidParameters.length > 0) {
        console.warn('Missing parameters:', result.InvalidParameters);
      }

      const params: Record<string, string> = {};
      result.Parameters.forEach((param: Parameter) => {
        if (param.Name && param.Value) {
          const key = param.Name.replace(`${this.parameterPrefix}/`, '');
          params[key] = param.Value;
        }
      });

      paramSpinner.succeed('Imported Vispyr SSM Parameters');

      return {
        instanceId: params['instance-id'] || '',
        publicIp: params['public-ip'] || '',
        privateIp: params['private-ip'] || '',
        httpsEndpoint: params['https-endpoint'] || '',
        peeringConnectionId: params['peering-connection-id'] || '',
        vpcId: params['vpc-id'] || '',
        deploymentTimestamp: params['deployment-timestamp'] || '',
      };
    } catch (error) {
      console.error('Error retrieving deployment parameters:', error);
      throw error;
    }
  }

  async getParameter(parameterName: string): Promise<string> {
    try {
      const command = new GetParameterCommand({
        Name: `${this.parameterPrefix}/${parameterName}`,
        WithDecryption: false,
      });

      const result = await this.ssmClient.send(command);
      return result.Parameter?.Value || '';
    } catch (error) {
      console.error(`Error retrieving parameter ${parameterName}:`, error);
      throw error;
    }
  }

  async deleteAllParameters(): Promise<void> {
    const paramSpinner = ora('Removing Vispyr SSM Parameters').start();
    await sleep(1000);

    try {
      const parameterNames = [
        `${this.parameterPrefix}/instance-id`,
        `${this.parameterPrefix}/public-ip`,
        `${this.parameterPrefix}/private-ip`,
        `${this.parameterPrefix}/https-endpoint`,
        `${this.parameterPrefix}/peering-connection-id`,
        `${this.parameterPrefix}/vpc-id`,
        `${this.parameterPrefix}/deployment-timestamp`,
      ];

      const batchSize = 10;
      for (let i = 0; i < parameterNames.length; i += batchSize) {
        const batch = parameterNames.slice(i, i + batchSize);

        const command = new DeleteParametersCommand({
          Names: batch,
        });

        await this.ssmClient.send(command);
        paramSpinner.succeed('Deleted Vispyr SSM Parameters');
      }
    } catch (error) {
      console.error('Error deleting parameters:', error);
      throw error;
    }
  }

  async listParameters(): Promise<void> {
    try {
      const command = new GetParametersByPathCommand({
        Path: this.parameterPrefix,
        Recursive: true,
      });

      const result = await this.ssmClient.send(command);

      console.log('Current Vispyr Parameters:');
      result.Parameters?.forEach((param: Parameter) => {
        console.log(`  ${param.Name}: ${param.Value}`);
      });
    } catch (error) {
      console.error('Error listing parameters:', error);
      throw error;
    }
  }
}
