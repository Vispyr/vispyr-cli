<div align="center">
  <a href="#">
    <img src="https://raw.githubusercontent.com/vispyr/.github/main/profile/assets/vispyr-banner.png" alt="Vispyr Banner" width="400">
  </a>
</div>

# What Vispyr CLI does

The **Vispyr Command Line Interface** has 2 basic functions:

1. [Deploy](#instructions-to-deploy) Vispyr infrastructure in AWS.
2. [Teardown](#instructions-to-teardown) Vispyr infrastructure from AWS.

When deploying, it automates the creation of:
* A VPC with a peering connection to your existing VPC.
* An EC2 instance.
* A Vispyr agent, responsible for instrumenting your application.
* Routing and security group rules.
* Vispyr's [backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend").

## Requirements

1. AWS credentials and region.
2. The VPC ID where the instrumented application is hosted.
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

This will prompt you to select the desired CIDR range. Then you'll select the Subnet you wish to link to [Vispyr's backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend") (should be the same where the app being instrumented is). And finally you'll be prompted to confirm the deployment.

This process usually takes between 5-10 minutes.

If using a custom domain, you will be asked to navigate to your domain registrar and add the new A Record. Be sure to use `vispyr` as the host. Once this step is done, hit `[ENTER]` to continue.

You will be provided the Grafana link and the `vispyr_agent` file. Use them in the following `Next Steps` instructions.

<details>

<summary>View detailed steps</summary>

## Deployment Process

1. **Validation**:  Tells the user everything that'll be deployed and asks for confirmation. Ensures all the necessary AWS credentials are present.
2. **Network discovery**: Finds the peering VPC. Generates non-overlapping CIDR. Queries the user for subnet selection.
3. **Infrastructure deployment**: Converts TypeScript CDK code into JSON CloudFormation template and saves in cdk.out/ directory. Sets up the CDK prerequisites in your AWS account: S3 bucket for storing assets and IAM roles for the CDK operations. Deploys AWS resources showing real-time CloudFormation progress and waits for completion.
4. **Post-deployment setup**: Gets the deployed infrastructure details. Uses those details to generate the configuration used by Vispyr agent to connect to the [backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend"). If the user included a domain in its `.env` file, it then shows instructions on how to set up SSL certificates Tests that the VPC peering and networking is working correctly
5. **User information**: Provides URL for accessing Vispyr's dashboard in Grafana's UI. Displays instructions for setting up agent from folder containing all pertinent configuration.

</details>

## Instructions to Teardown

To completely remove all Vispyr infrastructure from your AWS account, run:

```bash
npm start -- destroy
```

It will prompt you for confirmation. By continuing, you'll see status updates until a success message is presented. The teardown process will automatically clean up **all** Vispyr-related resources:
- **VispyrStack** (CloudFormation stack with all resources)
- **Vispyr EC2 Instance** (monitoring server)
- **Elastic IP** (static IP for the instance)
- **VPC Peering Connection** routes (networking between VPCs)
- **CDK Toolkit** and associated S3 bucket (unless other CDK stacks exist)

And all configuration/remaining data:
- **SSM Parameters** (stored deployment configuration)
- **Local files** (generated agent files and CLI artifacts)

The CLI will provide guidance on manual cleanup if automatic teardown fails.

<details>

<summary>View detailed steps</summary>

## Teardown Process

1. **Confirmation prompt**: You'll be asked to confirm the teardown.
2. **Automated cleanup**: The CLI handles all resource removal automatically.
3. **Progress feedback**: Real-time status updates during teardown.
4. **Completion confirmation**: Success message when finished.

</details>
