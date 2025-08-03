import { AWSConfigType, Region } from '../types';

export const exportEnvironment = (config: AWSConfigType) => {
  process.env.AWS_ACCESS_KEY_ID = config.aws_access_key_id;
  process.env.AWS_SECRET_ACCESS_KEY = config.aws_secret_access_key;
  process.env.AWS_REGION = config.aws_region as Region;
};

export const hasCredentials = () => {
  return (
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );
};
