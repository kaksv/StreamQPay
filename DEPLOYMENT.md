# Deployment

## Prerequisites

- Foundry installed (`forge`, `cast`).
- A wallet with tQDAY testnet gas and tUSD8 from the [official faucet](https://faucet.qday.info/en).
- Never use a mainnet key. Do not paste a seed phrase into the app or commit a private key.

## Verify the network

Official QDay parameters:

| Parameter | Value |
|---|---|
| Network | QDay Aevum Testnet |
| Chain ID | `44005` |
| RPC | `https://rpc-test.qday.info` |
| Native token | tQDAY |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` |
| tUSD8 decimals | `6` |
| Explorer | `https://explorer-test.qday.info` |

The network parameters are documented in the [QDay wallet guide](https://wiki.qday.info/guide/start/add-network); token details are listed on [QDay Official Links](https://qday.io/official-links).

## Test and build

```sh
cd contracts
forge test
forge build
```

## Deploy to Aevum Testnet

Set `PRIVATE_KEY` in the current shell using a secure secret manager or local environment. Never put it in a committed file. The script checks `block.chainid == 44005` and deploys against the official tUSD8 address.

```sh
cd contracts
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://rpc-test.qday.info \
  --broadcast
```

Record the resulting StreamPay address and deployment block from the actual broadcast output. Verify the deployment transaction and contract bytecode on `https://explorer-test.qday.info`. Do not claim a deployment until these steps have succeeded.

## Configure the web app

Copy `.env.example` to `apps/web/.env.local` and set:

```dotenv
NEXT_PUBLIC_CHAIN_ID=44005
NEXT_PUBLIC_RPC_URL=https://rpc-test.qday.info
NEXT_PUBLIC_TUSD8_ADDRESS=0x456569838f1d43009A91ebA4263147Afd7233483
NEXT_PUBLIC_STREAMPAY_ADDRESS=<verified-deployment-address>
NEXT_PUBLIC_DEPLOYMENT_BLOCK=<verified-deployment-block>
```

Start locally with `cd apps/web && pnpm dev`. Deploy the frontend to Vercel only after production build and testnet smoke checks pass.
