# What this tool does

The Vispyr Command Line Interface has 2 basic functions:

1. [Deploy](#instructions-to-deploy) Vispyr infrastructure in AWS.
2. [Teardown](#instructions-to-teardown) Vispyr infrastructure from AWS.

When deploying, it automates the creation of:
* A VPC with a peering connection to your existing VPC.
* An EC2 instance.
* A Vispyr agent on your EC2, responsible for instrumenting your application.
* Routing and security group rules.
* Vispyr's [backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend").

## Requirements

1. AWS credentials and region.
2. The VPC ID where the instrumented application "lives".
3. (Optional) Custom domain and email if user wants to access Vispyr dashboard from their domain.

## Instructions to Deploy

### Initial setup

Include a `.env` file in the CLI's root directory with the following:

```
AWS_ACCESS_KEY_ID=<your_access_key_id>
AWS_SECRET_ACCESS_KEY=<your_aws_secret_access_key>
AWS_REGION=<your_region>
PEER_VPC_ID=<VPC_ID_of_your_app>
VISPYR_DOMAIN=<example.com> (optional)
VISPYR_EMAIL=<example@gmail.com> (optional)
```

You'll find `<your_access_key_id>` and `<your_aws_secret_access_key>` in the users section of your AWS account.

`<your_region>` and `<VPC_ID_of_your_app>` are the AWS region and the VPC ID where the EC2 hosting your app is.

Optional:
The values associated with `VISPYR_DOMAIN` and `VISPYR_EMAIL` are used for Certbot. If not provided, the CLI will default to a self-signed certificate, which will then cause the browser to warn the user every time the dashboard is loaded. The domain should follow the structure `domainname.com` and the email can be any valid email, such as `myemail@gmail.com`.

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

## Instructions to Teardown

```
npm start -- destroy
```

Follow the prompts, then wait for this process to finish. Usually takes 5-10 minutes.

This should clean everything up!

## Process Steps

1. Validation:  Tells the user everything that'll be deployed and asks for confirmation. Ensures all the necessary AWS credentials are present.
2. Network discovery: Finds the peering VPC. Generates non-overlapping CIDR. Queries the user for subnet selection.
3. Infrastructure deployment: Converts TypeScript CDK code into JSON CloudFormation template and saves in cdk.out/ directory. Sets up the CDK prerequisites in your AWS account: S3 bucket for storing assets and IAM roles for the CDK operations. Deploys AWS resources showing real-time CloudFormation progress and waits for completion.
4. Post-deployment setup: Gets the deployed infrastructure details. Uses those details to generate the configuration used by Vispyr agent to connect to the [backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend"). If the user included a domain in its `.env` file, it then shows instructions on how to set up SSL certificates Tests that the VPC peering and networking is working correctly
5. User information: Provides URL for accessing Vispyr's dashboard in Grafana's UI. Displays instructions for setting up agent from folder containing all pertinent configuration.

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


