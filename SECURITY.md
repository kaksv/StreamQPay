# Security

## Design controls

- Sender funds each stream in full before accrual starts.
- All token movement uses OpenZeppelin `SafeERC20`.
- State updates precede outgoing transfers; mutating entrypoints use `ReentrancyGuard`.
- Withdrawals are limited to the recipient and cannot exceed `accrued - withdrawn`.
- Cancellation is sender-only, one-time, limited to cancellable streams before their end, and refunds only unaccrued funds.
- Per-stream escrow accounting prevents one stream from spending another's balance.
- Amount calculations use integer base units and `Math.mulDiv`; the full deposit accrues at the end.
- The contract has no owner, privileged withdrawal, fee, or proxy.
- Deposits that do not increase contract balance by the exact amount are rejected (fee-on-transfer tokens are unsupported).

## Operational safety

- Aevum Testnet only: chain ID `44005`. The deployment script refuses other chains.
- The deployed token is QDay's official tUSD8 test token (6 decimals). Do not use a substitute token for the challenge deployment.
- Never commit `.env` files, hardcode keys, request seed phrases, or run a mainnet deployment.
- Verify the final deployment address and transaction receipt on QDay's official testnet explorer before publishing it.

## Current status and limitations

The contract has not been externally audited or deployed. Foundry tests cover creation, timing, withdrawals, cancellation/refunds, token failures, reentrancy attempts, independent streams, rounding, and fuzzed accounting. Tests do not prove safety of the live tUSD8 implementation or RPC.

The event-history UI must cap block ranges and surface RPC failures. Live accrual is an estimate until reconciled against the contract. Before handling real-value assets, obtain an independent audit and reconsider limits, pausing, token governance, and incident response; those controls are intentionally absent from this testnet MVP.
