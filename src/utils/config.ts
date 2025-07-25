import fs from 'fs';
import path from 'path';
import { AWSConfigType } from '../types';

export const saveConfig = (config: AWSConfigType) => {
  writeToFile(toIniFormat(config));
  populateEnvironment(config);
};

const populateEnvironment = (config: AWSConfigType) => {
  process.env.AWS_ACCESS_KEY_ID = config.aws_access_key_id;
  process.env.AWS_SECRET_ACCESS_KEY = config.aws_secret_access_key;
  process.env.AWS_REGION = config.aws_region as string;
};

const writeToFile = (data: string) => {
  const filePath = path.resolve(process.cwd(), `.env`);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data, 'utf-8');
};

const toIniFormat = (obj: AWSConfigType) => {
  return Object.entries(obj)
    .map(([key, value]) => `${key.toUpperCase()}=${value}`)
    .join('\n');
};
