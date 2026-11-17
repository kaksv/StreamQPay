# StreamPay

StreamPay is a non-custodial stablecoin payment-streaming app for QDay Aevum Testnet. A sender escrows tUSD8 in a smart contract; a recipient's earned balance accrues with block time and can be withdrawn on demand. No tokens are transferred automatically each second.

> **Testnet only:** tUSD8 and tQDAY used here have no real monetary value. The contract has not been deployed from this workspace.

## Problem and solution

Conventional transfers settle everything at once, while recurring payroll and contractor payments require manual batches. StreamPay funds a payment once, then makes the recipient's entitlement accrue over a defined duration. Recipients can claim earned tokens at any time; a sender may cancel a cancellable stream and receive only the not-yet-earned amount.

## Core flow

1. Connect an EVM wallet and switch to Aevum Testnet.
2. Approve tUSD8 for the StreamPay contract.
3. Create and fully fund a stream.
4. The recipient checks their on-chain accrued and withdrawable amounts.
5. The recipient withdraws earned tokens. A sender may cancel a cancellable stream before its end.

The UI's per-second counter is an estimate based on the last confirmed state and local time. Contract reads remain authoritative, and token transfers happen only in confirmed withdrawal or cancellation transactions.

## Stack

- Solidity 0.8.28, Foundry, OpenZeppelin Contracts 5.4.0
- Next.js App Router, React, TypeScript, Tailwind CSS
- wagmi and viem for wallet and EVM integration (web app integration follows contract tests)
- QDay Aevum Testnet, tUSD8 (6 decimals)

## Repository

```text
apps/web/             Next.js app
contracts/src/        StreamPay contract
contracts/test/       Foundry tests and local-only mock token
contracts/script/     Testnet deployment script
ARCHITECTURE.md       System and data-flow design
SECURITY.md           Security decisions and current limitations
DEPLOYMENT.md         Testnet deployment and frontend setup
DEMO_SCRIPT.md        3–5 minute demonstration outline
```

## Aevum integration

The QDay official builder page and network guide identify Aevum Testnet as chain `44005`, RPC `https://rpc-test.qday.info`, native gas token tQDAY, and the tUSD8 token at `0x456569838f1d43009A91ebA4263147Afd7233483`. An on-chain `decimals()` read returned `6`; the token address returned deployed bytecode. The official network guide lists the explorer as `https://explorer-test.qday.info`.

All values are testnet-only. Do not infer a production network or use real funds. See the [official challenge](https://qday.io/builder-challenge), [network guide](https://wiki.qday.info/guide/start/add-network), and [official links](https://qday.io/official-links).

## Local setup

Requirements: Node.js 20+, pnpm, Foundry (`forge`, `cast`).

```sh
pnpm install
cd contracts
npm install
forge test
forge build
```

Run the web app:

```sh
cd apps/web
pnpm dev
```

Copy `.env.example` to `.env.local` for web configuration. Set `NEXT_PUBLIC_STREAMPAY_ADDRESS` only after deploying the contract. The app must not present local mock-token test data as real chain activity.

## Contract behavior

- Each stream is independently funded and stored; streams cannot spend one another's escrow.
- Accrual is `floor(deposit * elapsed / duration)` with OpenZeppelin `Math.mulDiv`.
- At the end timestamp, accrued amount is exactly the full deposit.
- Cancellation freezes accrual at the cancellation timestamp and refunds `deposit - accrued`.
- Event logs (`StreamCreated`, `StreamWithdrawn`, `StreamCancelled`) are the discovery/history index; contract reads supply current state.
- No administrator, upgrade path, protocol fee, or privileged withdrawal exists.

## Testing

```sh
cd contracts
forge test -vv
forge build
forge fmt --check
```

The tests use a local mock ERC-20 only. Current result: 26 tests passed, including two fuzz tests (256 runs each). This is not a security audit or an Aevum deployment verification.

## Wallet configuration

Add Aevum Testnet to the wallet using chain ID `44005`, RPC `https://rpc-test.qday.info`, and native currency `tQDAY`. Test QDAY and tUSD8 are available through the official [QDay faucet](https://faucet.qday.info/en). Never share a seed phrase or private key.

## Screenshots

_Add screenshots of the connected dashboard, stream confirmation, live stream details, and transaction evidence after testnet deployment._

## Hackathon

Built for the [Aevum Builder Challenge #1](https://dorahacks.io/hackathon/qday/detail), with submissions closing December 11, 2026 at 08:00 UTC. The project is not yet deployed or submitted.

## Known limitations

- StreamPay is deployed on QDay Aevum at `0x3636B7955805ee9af9A974fa883EC39F10701E9D` with deployment block `3381660`.
- Event queries must use bounded block ranges and will be subject to the configured RPC's historical log limits.
- The displayed live balance is a local estimate until reconciled with an on-chain read.
- Only the official tUSD8 address is used by the deployment script; local tests use a mock token.
