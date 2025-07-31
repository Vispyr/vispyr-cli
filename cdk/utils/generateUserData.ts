import { UserData } from 'aws-cdk-lib/aws-ec2';

export const generateUserData = (commands: string[]) => {
  const userData = UserData.forLinux();
  userData.addCommands(...commands);

  return userData;
};
