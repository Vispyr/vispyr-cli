import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import createVpcWithPeering from '../utils/createVpcWithPeering.js';
import createSecurityGroup from '../utils/createSecurityGroup.js';
import createInstanceRole from '../utils/createInstanceRole.js';
import createInstanceWithEip from '../utils/createInstanceWithEip.js';
import setupRouting from '../utils/setupRouting.js';
import storeDeploymentParameters from '../utils/storeDeploymentParameters.js';

interface VispyrBackendProps extends StackProps {
  peerVpcId: string;
  domain?: string;
  email?: string;
}

export class VispyrBackend extends Stack {
  constructor(scope: Construct, id: string, props: VispyrBackendProps) {
    super(scope, id, props);

    const { peerVpcId, domain, email } = props;
    const { vpc, peerVpc, peeringConnection } = createVpcWithPeering(
      this,
      peerVpcId
    );

    const securityGroup = createSecurityGroup(this, vpc, peerVpc.vpcCidrBlock);
    const role = createInstanceRole(this);
    const { instance, eip } = createInstanceWithEip(
      this,
      vpc,
      securityGroup,
      role,
      domain,
      email
    );
    setupRouting(this, vpc, peerVpc, peeringConnection);
    storeDeploymentParameters(this, instance, peeringConnection, eip, vpc);
  }
}
