import path from 'path';
import fs from 'fs';
import { styleLog } from '../shared';

const ERROR = 'red';
const INFO = 'yellow';

const checkEnvFile = (): { hasEnv: boolean; peerVpcId?: string } => {
  const envPath = path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    return { hasEnv: false };
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const peerVpcMatch = envContent.match(/PEER_VPC_ID=(.+)/);

  if (peerVpcMatch) {
    const peerVpcId = peerVpcMatch[1].trim().replace(/['"]/g, '');
    return { hasEnv: true, peerVpcId };
  }

  return { hasEnv: true };
};

export const getPeerVpcId = () => {
  const { hasEnv, peerVpcId } = checkEnvFile();

  if (!hasEnv) {
    styleLog(ERROR, '.env file not found.');
    styleLog(INFO, 'Please create a .env file with PEER_VPC_ID=vpc-xxxxxxxxx');
    process.exit(1);
  }

  if (!peerVpcId) {
    styleLog(ERROR, 'PEER_VPC_ID not found in .env file');
    styleLog(INFO, 'Please add PEER_VPC_ID=vpc-xxxxxxxxx to your .env file');
    process.exit(1);
  }

  return peerVpcId;
};
