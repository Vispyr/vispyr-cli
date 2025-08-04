# To run the CLI

## Initial setup

Include a `.env` file in the CLI's root directory with these fields

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
PEER_VPC_ID
```

- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are generated in users section of AWS
- `AWS_REGION` is your desired region to deploy
- `PEER_VPC_ID` is the VPC ID of your desired app to instrument

Navigate to the CLI's root directory and run 

```
npm install
```

## Infrastructure Deployment

```
npm build && npm start -- deploy
```

This will walk you through a series of steps:
- Select the desired CIDR range (required step as the CIDR must be different between VPCs)
- Select the Subnet you wish to link to backend (should be the one with the app you want to instrument)
- Confirm deployment

This process usually takes between 5-10 minutes.

You will be provided the Grafana link and the `vispyr_agent` file. Follow the `Next Steps` instructions.

## Infrastructure Teardown

This will tear down the entire Vispyr Backend, including:
- VispyrStack (CloudFormation)
- Vispyr EC2 Instance
- CDKToolkit + S3 Bucket, unless you have other stacks present
- SSM Parameters for Vispyr Backend
- Elastic IP used for the Internet Gateway
- Routes used for the Peering Connection
- Local files created by the CLI

```
npm start -- destroy
```

Follow the prompts, then wait for this process to finish. Usually takes 5-10 minutes.

This should clean everything up!