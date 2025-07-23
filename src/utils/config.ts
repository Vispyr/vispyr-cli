import fs from 'fs';
import path from 'path';
import { AWSConfigType, AWSCredentialsType } from '../types';

export const saveConfig = (
  credentials: AWSCredentialsType,
  config: AWSConfigType
) => {
  writeToFile('credentials', toIniFormat(credentials));
  writeToFile('config', toIniFormat(config));
};

const writeToFile = (file: string, data: string) => {
  const filePath = path.resolve(process.cwd(), `.aws/${file}`);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data, 'utf-8');
};

const toIniFormat = (obj: AWSCredentialsType | AWSConfigType) => {
  return [
    '[default]',
    ...Object.entries(obj).map(
      ([key, value]) => `${key.toUpperCase()}=${value}`
    ),
  ].join('\n');
};
