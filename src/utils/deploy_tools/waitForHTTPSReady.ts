import ora from 'ora';
import { execAsync } from '../shared';

export const waitForHTTPSReady = async (
  httpsEndpoint: string
): Promise<void> => {
  const spinner = ora(
    'Waiting for HTTPS endpoint and application deployment...'
  ).start();

  let attempts = 0;
  const maxAttempts = 90;

  while (attempts < maxAttempts) {
    try {
      const { stdout } = await execAsync(
        `curl -k -s -o /dev/null -w "%{http_code}" ${httpsEndpoint}/api/health || echo "000"`
      );

      if (stdout.trim() === '200') {
        spinner.succeed('HTTPS endpoint is ready and Grafana is responding');
        return;
      }

      const minutes = Math.floor((attempts * 10) / 60);
      const seconds = (attempts * 10) % 60;
      spinner.text = `Waiting for HTTPS endpoint... (${minutes}:${seconds
        .toString()
        .padStart(2, '0')} elapsed)`;

      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    }
  }

  spinner.warn(
    'HTTPS endpoint monitoring timeout - deployment may still be in progress'
  );
};

export default waitForHTTPSReady;
