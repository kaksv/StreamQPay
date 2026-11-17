# StreamPay demo (3–5 minutes)

**Status:** This outline assumes a verified Aevum Testnet deployment and funded demo wallets. No deployment address is currently recorded, so do not present this as an already completed live demo.

## 0:00–0:35 — Problem

“Most payments settle all at once. Payroll and contractor payments are usually split into manual batches. StreamPay makes one funded payment accrue over time, while keeping control with the sender and recipient.”

## 0:35–1:10 — Aevum and the agreement

Show the connected wallet on chain `44005`, the tUSD8 testnet notice, and the stream form. Enter the recipient, amount, duration, and cancellation option. Review the amount, rate, start/end times, and token allowance before signing.

## 1:10–2:00 — Fund the stream

Approve tUSD8, wait for the approval receipt, and create the stream. Show the confirmed transaction and `StreamCreated` event on the official QDay testnet explorer. Point out that the full deposit is held before streaming starts; there are no per-second transfers.

## 2:00–2:45 — Accrue and withdraw

Connect as the recipient. Show the live counter advancing, labelled as an estimate, alongside the authoritative on-chain accrued and withdrawable values. Withdraw a partial earned amount and confirm the receipt and `StreamWithdrawn` event.

## 2:45–3:35 — Cancel a separate stream

Create or select another cancellable stream, then cancel it as its sender before the end. Show the `StreamCancelled` event: accrued tokens remain reserved for the recipient and only the unaccrued amount is returned to the sender. Withdraw the recipient's remaining entitlement afterward.

## 3:35–4:00 — Close

Show the transaction history with real hashes and timestamps. “StreamPay combines continuous payment entitlement with ordinary, verifiable ERC-20 transfers on Aevum Testnet. The test tokens have no monetary value.”

## Evidence checklist

- Confirm chain ID and official tUSD8 address.
- Capture successful approval, stream creation, withdrawal, and cancellation receipts.
- Show the event and matching contract state on the verified explorer.
- Do not show demo fixtures or local mock-token activity as real blockchain data.
