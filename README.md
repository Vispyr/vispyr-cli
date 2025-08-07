# Purposes

This CLI performs 2 main functions:
1. Deploy Vispyr infrastructure.
2. Teardown Vispyr infrastructure.

## Deployment

It follows a step-by-step process:

### Validation
* Tells the user everything that'll be deployed and asks for confirmation
* Ensures all the necessary AWS credentials are present
### Network discovery:
* Finds the peering VPC
* Generates non-overlapping CIDR
* Queries the user for subnet selection
### Infrastructure deployment:
* Converts TypeScript CDK code into JSON CloudFormation template and saves in cdk.out/ directory
* Sets up the CDK prerequisites in your AWS account: S3 bucket for storing assets and IAM roles for the CDK operations
* Deploys AWS resources showing real-time CloudFormation progress and waits for completion
### Post-deployment setup: 
* Gets the deployed infrastructure details 
* Uses those details to generate the configuration used by Vispyr agent to connect to the [backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend")
* If the user included a domain in its `.env` file, it then shows instructions on how to set up SSL certificates
* Tests that the VPC peering and networking is working correctly
### User information: 
* Provides URL for accessing Vispyr's dashboard in Grafana's UI
* Displays instructions for setting up agent from folder containing all pertinent configuration

# To run the CLI

## Initial setup

Include a `.env` file in the CLI's root directory with these fields

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
PEER_VPC_ID
VISPYR_DOMAIN
VISPYR_EMAIL
```

Required:
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are generated in users section of AWS
- `AWS_REGION` is your desired region to deploy
- `PEER_VPC_ID` is the VPC ID of your desired app to instrument

Optional:
- `VISPYR_DOMAIN` and `VISPYR_EMAIL` are used for Certbot. If not provided, then the CLI will default to a self-signed certificate. The domain should follow the structure `example.com` and the email can be any valid email, such as `example@gmail.com`.

Navigate to the CLI's root directory and run 

```
npm install
```

## Infrastructure Deployment

```
npm run build && npm start -- deploy
```

This will walk you through a series of steps:
- Select the desired CIDR range (required step as the CIDR must be different between VPCs)
- Select the Subnet you wish to link to backend (should be the one with the app you want to instrument)
- Confirm deployment

This process usually takes between 5-10 minutes.

If using a custom domain, you will be prompted to navigate to your domain registrar and add the new A Record. Be sure to use `vispyr` as the host. Once this step is done, you can hit `[ENTER]` to continue.

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
