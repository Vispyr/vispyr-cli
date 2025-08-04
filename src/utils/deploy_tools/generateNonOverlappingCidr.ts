import chalk from 'chalk';
import { p } from '../shared.js';

const generateNonOverlappingCidr = (peerVpcCidr: string): string => {
  const peerOctets = peerVpcCidr.split('.').slice(0, 2);

  const secondOctet = parseInt(peerOctets[1]);
  const newSecondOctet = secondOctet === 0 ? 1 : secondOctet === 1 ? 2 : 0;
  const newVpcCidr = `${peerOctets[0]}.${newSecondOctet}.0.0/16`;
  p(chalk.blue(`New VPC will use CIDR: ${newVpcCidr}\n`));

  return newVpcCidr;
};

export default generateNonOverlappingCidr;
