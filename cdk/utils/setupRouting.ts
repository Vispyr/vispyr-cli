import { Construct } from 'constructs';
import {
  Vpc,
  CfnVPCPeeringConnection,
  CfnRoute,
  IVpc,
} from 'aws-cdk-lib/aws-ec2';

const setupRouting = (
  scope: Construct,
  vpc: Vpc,
  peerVpc: IVpc,
  peeringConnection: CfnVPCPeeringConnection
): void => {
  vpc.publicSubnets.forEach((subnet, index) => {
    const route = new CfnRoute(scope, `PublicRoute${index}ToPeer`, {
      routeTableId: subnet.routeTable.routeTableId,
      destinationCidrBlock: peerVpc.vpcCidrBlock,
      vpcPeeringConnectionId: peeringConnection.attrId,
    });

    route.addDependency(peeringConnection);
  });

  vpc.privateSubnets.forEach((subnet, index) => {
    const route = new CfnRoute(scope, `PrivateRoute${index}ToPeer`, {
      routeTableId: subnet.routeTable.routeTableId,
      destinationCidrBlock: peerVpc.vpcCidrBlock,
      vpcPeeringConnectionId: peeringConnection.attrId,
    });

    route.addDependency(peeringConnection);
  });
};

export default setupRouting;
