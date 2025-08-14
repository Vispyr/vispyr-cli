<div align="center">
  <a href="https://vispyr.com">
    <img src="https://raw.githubusercontent.com/vispyr/.github/main/profile/assets/vispyr-banner.png" alt="Vispyr Banner" width="400">
  </a>
</div>

# What the CLI does

The **Vispyr Command Line Interface** has 2 basic functions:

1. [Deploy](#instructions-to-deploy) Vispyr infrastructure in AWS.
2. [Teardown](#instructions-to-teardown) Vispyr infrastructure from AWS.

When deploying, it automates the creation of:
* A VPC with a peering connection to your existing VPC.
* An EC2 instance.
* A Vispyr agent, responsible for instrumenting your application.
* Routing and security group rules.
* [Vispyr's backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend").

## Requirements

1. AWS credentials and region of the EC2 where your application runs.
2. The corresponding VPC ID.
3. (Optional) Custom domain and email if the user wants to access Vispyr dashboard from their domain.

## Instructions to Deploy

### Initial setup

Clone this repository and navigate to its root directory:
```
git clone https://github.com/Vispyr/vispyr-cli.git && cd vispyr-cli
```

Create a `.env` file as follows:

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

> Optional: give values for `VISPYR_DOMAIN` and `VISPYR_EMAIL` if you would like to access Vispyr dashboard from your own, custom, UREL. They are used by Certbot for generating TLS certification. If not provided, the CLI will default to a self-signed certificate, which will then cause the browser to show a warning every time the dashboard is loaded. The domain should follow the structure `domainname.com` and the email can be any valid email, such as `myemail@gmail.com`.

Now run:

```
npm install
```

### CLI session

To execute the CLI program, from the root directory run:

```
npm run build && npm start -- deploy
```

This will prompt you to select the desired CIDR range. Then you'll select the Subnet you wish to link to [Vispyr's backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend") (should be the same where the app being instrumented is). And finally you'll be prompted to confirm the deployment.

This process usually takes between 5-10 minutes.

> Optional: If using a custom domain, you will be asked to navigate to your domain registrar and add the new A Record. Be sure to use `vispyr` as the host. Once this step is done, hit `[ENTER]` to continue.

You will be given some "Next Steps" instructions. They include the Grafana link and the location of the `vispyr_agent` folder.

<details>

<summary>View CLI session in detail</summary>

1. **Validation**:  
* Tells the user everything that'll be deployed and asks for confirmation. 
* Ensures all the necessary AWS credentials are present.
2. **Network discovery**: 
* Finds the peering VPC. 
* Generates non-overlapping CIDR. 
* Queries the user for subnet selection.
3. **Infrastructure deployment**: 
* Converts TypeScript CDK code into JSON CloudFormation template and saves it in the cdk.out/ directory. 
* Sets up the CDK prerequisites in your AWS account: S3 bucket for storing assets and IAM roles for the CDK operations. 
* Deploys AWS resources showing real-time CloudFormation progress and waits for completion.
4. **Post-deployment setup**: 
* Gets the deployed infrastructure details. 
* Uses those details to generate the configuration used by Vispyr agent to connect to the [backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend"). 
* If the user included a domain in its `.env` file, it then shows instructions on how to set up SSL certificates. 
* Tests that the VPC peering and networking are working correctly.
5. **User information**: 
* Provides URL for accessing Vispyr's dashboard in Grafana's UI. 
* Displays instructions for setting up Agent from folder containing all pertinent configuration.

</details>

### Deploying the Vispyr Agent

Place the `vispyr_agent` folder, mentioned the "Next Steps" of the CLI session, in the root directory of your application (same location as the `package.json`).

Now edit `package.json` and modify the production start command of the application to:

```
bash ./vispyr_agent/deployAgent.sh && node --require ./vispyr_agent/instrumentation.js src/<your-app-name>.js
```

`<your-app-name>` refers to the file name of your NodeJS application.

> Optional: If you want to name your application something other than `node_app` on Vispyr's dashboard, populate the following variables in your application runtime environment:

```
OTEL_SERVICE_NAME=<your-app-name>
OTEL_RESOURCE_ATTRIBUTES=service.namespace=<your-app-name>
```

> If you're using `.env` in your production environment, go back to `package.json` and include the flag `--env-file=./.env` (assuming the `.env` is in the same folder as your `package.json` file, otherwise substitute `./` with its relative path) in the node portion of the start command cited above.

Redeploy and restart your app through your regular CI/CD process.

## Instructions to Teardown

To completely remove all of [Vispyr's backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend") and its infrastructure from your AWS account, go to the CLI root directory and run:

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

Remove the `vispyr_agent` folder and its contents from your application and redeploy it.

Edit your `package.json` start command back to its initial form, i.e. instead of:
```
bash ./vispyr_agent/deployAgent.sh && node --require ./vispyr_agent/instrumentation.js src/<your-app-name>.js
```
Something similar to:
```
node src/<your-app-name>
```
