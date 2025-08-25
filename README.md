<div align="center">
  <a href="https://vispyr.com">
    <img src="https://raw.githubusercontent.com/vispyr/.github/main/profile/assets/vispyr-banner.png" alt="Vispyr Banner" width="400">
  </a>
</div>

# Overview

The **Vispyr Command Line Interface** has 2 basic functions:

1. [Deploy](#instructions-to-deploy) Vispyr infrastructure in AWS.
2. [Teardown](#instructions-to-teardown) Vispyr infrastructure from AWS.

When deploying, it automates the creation of:
* A VPC with a peering connection to your existing VPC.
* An EC2 instance.
* A Vispyr agent, responsible for instrumenting your application.
* Routing and security group rules.
* [Vispyr's backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend").

# Requirements

1. AWS credentials and the region of the EC2 where your application runs.
2. The corresponding VPC ID.
3. (Optional) Custom domain and email if the user wants to access the Vispyr dashboard from their domain.

# Instructions to Deploy

## 1. Initial setup

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

<details>
    <summary>Optional</summary>
    <br>
    Provide values for <code>VISPYR_DOMAIN</code> and <code>VISPYR_EMAIL</code> if you would like to access the Vispyr dashboard from your own, custom, URL. They are used by Certbot for generating TLS certificates. If not provided, the CLI will default to a self-signed certificate, which will then cause the browser to show a warning every time the dashboard is loaded. The domain should follow the structure <code>domainname.com</code>, and the email can be any valid email, such as <code>myemail@gmail.com</code>.
</details>

Now run:

```
npm install
```

## 2. CLI session

To execute the CLI program, from the root directory run:

```
npm run build && npm start -- deploy
```

This will prompt you to select the desired CIDR range. Then you'll select the Subnet you wish to link to [Vispyr's backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend") (this should be the same subnet used by the application you’re trying to instrument). And finally, you'll be prompted to confirm the deployment.

This process usually takes between 5-10 minutes.

<details>
    <summary>Optional</summary>
    <br>
    If using a custom domain, you will be asked to navigate to your domain registrar and add the new A Record. Be sure to use <code>vispyr</code> as the host. Once this step is done, hit <code>[ENTER]</code> to continue.
</details>

You will be given some "Next Steps" instructions. They include the Grafana link and the location of the `vispyr_agent` folder.

<details>
<summary>Click here for a detailed, step-by-step description of the CLI session</summary>

<br>

1. **Validation**  
   * Tells the user everything that'll be deployed and asks for confirmation. 
   * Ensures all the necessary AWS credentials are present.

2. **Network discovery**  
   * Finds the peering VPC. 
   * Generates non-overlapping CIDR. 
   * Queries the user for subnet selection.

3. **Infrastructure deployment**  
   * Converts TypeScript CDK code into JSON CloudFormation template and saves it in the `cdk.out/` directory. 
   * Sets up the CDK prerequisites in your AWS account: S3 bucket for storing assets and IAM roles for the CDK operations.
   * Deploys AWS resources showing real-time CloudFormation progress and waits for completion.

4. **Post-deployment setup**  
   * Gets the deployed infrastructure details. 
   * Uses those details to generate the configuration used by the Vispyr agent to connect to the [backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend"). 
   * If the user included a domain in its `.env` file, it then shows instructions on how to set up SSL certificates. 
   * Tests that the VPC peering and networking are working correctly.

5. **User information**  
   * Provides URL for accessing Vispyr's dashboard in Grafana's UI. 
   * Displays instructions for setting up the Agent from the folder containing all pertinent configuration.

</details>


## 3. Deploying the Vispyr Agent

Place the `vispyr_agent` folder, mentioned in the "Next Steps" of the CLI session, in the root directory of your application (same location as the `package.json`).

Now edit `package.json` and modify the production start command of the application to:

```
bash ./vispyr_agent/deployAgent.sh && node --require ./vispyr_agent/instrumentation.js <path_to_your_app>
```

`<your-app-name>` refers to the file name of your NodeJS application.

<details>
    <summary>Optional</summary>
    <br>
    If you want to name your application something other than <code>node_app</code> on Vispyr's dashboard, populate the following variables in your application runtime environment:

```
OTEL_SERVICE_NAME=<your-app-name>
OTEL_RESOURCE_ATTRIBUTES=service.namespace=<your-app-name>
```

If using <code>.env</code> in your production environment, go back to <code>package.json</code> and include the flag <code>--env-file=./.env</code> (assuming the <code>.env</code> is in the same folder as your <code>package.json</code> file, otherwise substitute <code>./</code> with its relative path) in the node portion of the start command cited above.
</details>

Redeploy and restart your app through your regular CI/CD process.

# Instructions to Teardown

To completely remove all of [Vispyr's backend](https://github.com/Vispyr/vispyr-backend "Go to Vispyr backend") and its infrastructure from your AWS account, go to the CLI root directory and run:

```bash
npm start -- destroy
```

The CLI will prompt you for confirmation. By continuing, you'll see status updates until a success message is presented. The teardown process will automatically clean up **all** Vispyr-related resources:
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

Edit your `package.json` start command back to its initial form.
