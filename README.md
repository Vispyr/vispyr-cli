# To run the CLI

I have not tested with `npm start` in its current phase. All commands will use `npm run dev` instead.

1. Initial setup

Include a `.env` file in the CLI's root directory with these fields

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
PEER_VPC_ID
PERSONAL_ACCESS_TOKEN
```

- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are generated in users section of AWS
- `AWS_REGION` is your desired region to deploy
- `PEER_VPC_ID` is the VPC ID of your desired app to instrument
- `PERSONAL_ACCESS_TOKEN` is generated on GitHub. Required because the backend repo is currently private.

Be sure the app you wish to instrument is in a Public Subnet of a VPC.

Navigate to the CLI's root directory and run 

```
npm install
```

2. Deploy Backend

```
npm run dev -- deploy-backend
```

This will walk you through a series of steps:
- Select the desired CIDR range (required step as the CIDR must be different between VPCs)
- Select the Subnet you wish to link to backend (should be the one with the app you want to instrument)
- Confirm deployment

This process usually takes between 5-10 minutes.

You will be provided the Grafana link. Follow the `Next Steps` instructions.

2. Deploy Agent

```
npm run dev -- deploy-agent
```

This will walk you through another series of steps:
- Select the instance you want to install the agent (found via VPC peering)
- Confirm deployment

This process usually takes 3-5 minutes.

After this, everything should be working!

3. Destroy Everything

When tearing down, tear the agent down first, then the backend.

```
npm run dev -- destroy-agent
```

Follow the prompts, then wait for this process to finish. Usually takes 3-5 minutes.

```
npm run dev -- destroy-backend
```

Follow the prompts, then wait for this process to finish. Usually takes 5-10 minutes.

This should clean everything up!