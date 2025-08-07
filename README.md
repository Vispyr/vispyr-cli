# What it does

The Vispyr Command Line Interface is designed to perform 2 basic functions:

1. [Deploy](#deployment) Vispyr infrastructure in AWS.
2. [Remove](#teardown) Vispyr infrastructure from AWS.

It automates a great deal of these processes and therefore the following sections go into details of what happens "under the hood" when the CLI is running, before providing a set of instructions with all the steps necessary to operate the tool.

# Deployment

## Requirements

1. AWS credentials and region.
2. The VPC ID where the instrumented application "lives".
3. (Optional) Custom domain and email if user wants to access Vispyr dashboard from their domain.

## Process

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

## Instructions

### Initial setup

Include a `.env` file in the CLI's root directory with these fields

```
AWS_ACCESS_KEY_ID=<your_access_key_id>
AWS_SECRET_ACCESS_KEY=<your_aws_secret_access_key>
AWS_REGION=<your_region>
PEER_VPC_ID=<VPC_ID_of_your_app>
VISPYR_DOMAIN=<example.com> (optional)
VISPYR_EMAIL=<example@gmail.com> (optional)
```

To find `<your_access_key_id>` and `<your_aws_secret_access_key>`, navigate to the users section of your AWS account. `<your_region>` is the region where Vispyr's infrastructure will be deployed, it must be the same region where your app is. `<VPC_ID_of_your_app>` is the VPC ID of the EC2 where the instrumented app is installed.

Optional:
The values associated with `VISPYR_DOMAIN` and `VISPYR_EMAIL` are used for Certbot. If not provided, then the CLI will default to a self-signed certificate, which will then prompt the browser to warn the user every time the dashboard is loaded. The domain should follow the structure `domainname.com` and the email can be any valid email, such as `myemail@gmail.com`.

Now navigate to the CLI's root directory and run:

```
npm install
```

### CLI session

To execute the CLI program run:

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

# Teardown

## Process

This will tear down the entire Vispyr Backend, including:
- VispyrStack (CloudFormation)
- Vispyr EC2 Instance
- CDKToolkit + S3 Bucket, unless you have other stacks present
- SSM Parameters for Vispyr Backend
- Elastic IP used for the Internet Gateway
- Routes used for the Peering Connection
- Local files created by the CLI

## Instructions

```
npm start -- destroy
```

Follow the prompts, then wait for this process to finish. Usually takes 5-10 minutes.

This should clean everything up!
