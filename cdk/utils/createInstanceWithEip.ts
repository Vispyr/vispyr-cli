import { Construct } from 'constructs';
import {
  Instance,
  InstanceType,
  MachineImage,
  Vpc,
  SecurityGroup,
  SubnetType,
  CfnEIP,
} from 'aws-cdk-lib/aws-ec2';
import { Role } from 'aws-cdk-lib/aws-iam';
import vispyrBackendCommands from '../user_commands/vispyrBackendCommands.js';
import generateUserData from './generateUserData.js';

interface InstanceSetupResult {
  instance: Instance;
  eip: CfnEIP;
}

const createInstanceWithEip = (
  scope: Construct,
  vpc: Vpc,
  securityGroup: SecurityGroup,
  role: Role,
  bucketName: string,
  region: string,
  domain?: string,
  email?: string
): InstanceSetupResult => {
  const userData = generateUserData(
    vispyrBackendCommands(bucketName, region, domain, email)
  );

  const instance = new Instance(scope, 'VispyrBackend', {
    vpc,
    instanceType: new InstanceType('t3.medium'),
    machineImage: MachineImage.latestAmazonLinux2023(),
    role,
    securityGroup,
    userData,
    vpcSubnets: {
      subnetType: SubnetType.PUBLIC,
    },
  });

  const eip = new CfnEIP(scope, 'VispyrEIPAssociation', {
    domain: 'vpc',
    instanceId: instance.instanceId,
  });

  return { instance, eip };
};

export default createInstanceWithEip;
