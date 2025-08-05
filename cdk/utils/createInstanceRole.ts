import { Construct } from 'constructs';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';

const createInstanceRole = (scope: Construct): Role => {
  const role = new Role(scope, 'VispyrInstanceRole', {
    assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    ],
  });

  return role;
};

export default createInstanceRole;
