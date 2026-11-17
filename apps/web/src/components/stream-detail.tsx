"use client";

import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useWriteContract } from "wagmi";
import { parseUnits, type Address, type Hex } from "viem";
import { streamPayAbi } from "@/lib/abi";
import { AEVUM_CHAIN, publicClient } from "@/lib/chain";
import {
  estimateAccrued,
  formatDate,
  formatDuration,
  formatPercent,
  formatRatePerHour,
  formatRatePerSecond,
  formatTokenAmount,
  shortAddress,
  TOKEN_DECIMALS,
} from "@/lib/numbers";
import type { StreamRecord, WalletData } from "@/lib/streams";
import { TokenAmount } from "@/components/token-amount";

interface StreamDetailProps {
  stream: StreamRecord;
  data: WalletData;
  nowMs: number;
  walletAddress: Address;
  contractAddress: Address;
  networkReady: boolean;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}

export function StreamDetail({
  stream,
  data,
  nowMs,
  walletAddress,
  contractAddress,
  networkReady,
  onBack,
  onRefresh,
}: StreamDetailProps) {
  const { writeContractAsync } = useWriteContract();
  const [withdrawInput, setWithdrawInput] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pendingAction, setPendingAction] = useState<"withdraw" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hex | null>(null);
  const [transactionStatus, setTransactionStatus] = useState<
    "pending" | "confirmed" | "failed" | null
  >(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const localElapsed = BigInt(Math.max(0, Math.floor((nowMs - data.fetchedAtMs) / 1000)));
  const estimatedChainTime = data.blockTimestamp + localElapsed;
  const estimate = estimateAccrued(
    stream.deposit,
    stream.startTime,
    stream.endTime,
    stream.cancelledAt,
    stream.cancelled,
    data.blockTimestamp,
    data.fetchedAtMs,
    nowMs,
  );
  const estimatedAvailable = estimate > stream.withdrawn ? estimate - stream.withdrawn : BigInt(0);
  const status = stream.cancelled
    ? "Cancelled"
    : estimatedChainTime >= stream.endTime
      ? "Completed"
      : estimatedChainTime < stream.startTime
        ? "Scheduled"
        : "Streaming";
  const elapsedAt = stream.cancelled
    ? stream.cancelledAt
    : estimatedChainTime < stream.endTime
      ? estimatedChainTime
      : stream.endTime;
  const elapsed = elapsedAt > stream.startTime ? elapsedAt - stream.startTime : BigInt(0);
  const duration = stream.endTime - stream.startTime;
  const remaining = duration > elapsed ? duration - elapsed : BigInt(0);
  const progress = formatPercent(elapsed, duration);
  const progressWidth = `${progress === "--" ? "0" : progress.slice(0, -1)}%`;
  const remainingUnaccrued = stream.deposit > estimate ? stream.deposit - estimate : BigInt(0);
  const isRecipient = walletAddress.toLowerCase() === stream.recipient.toLowerCase();
  const isSender = walletAddress.toLowerCase() === stream.sender.toLowerCase();
  const canCancel =
    isSender &&
    stream.cancellable &&
    !stream.cancelled &&
    estimatedChainTime < stream.endTime;

  async function refreshConfirmedData() {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } catch (error) {
      setActionError(transactionErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setWithdrawError(null);
    setActionMessage(null);
    if (!isRecipient) {
      setActionError("Only the recipient wallet can withdraw from this stream.");
      return;
    }
    if (!networkReady) {
      setActionError("Connect the recipient wallet on QDay Aevum Testnet to withdraw.");
      return;
    }

    let amount: bigint;
    try {
      amount = parseUnits(withdrawInput.trim(), TOKEN_DECIMALS);
    } catch {
      setWithdrawError("Enter a valid tUSD8 amount with up to 6 decimals.");
      return;
    }
    if (amount <= BigInt(0)) {
      setWithdrawError("Enter an amount greater than zero.");
      return;
    }
    if (amount > stream.available) {
      setWithdrawError(
        `The confirmed withdrawable balance is ${formatTokenAmount(stream.available).display} tUSD8.`,
      );
      return;
    }

    setPendingAction("withdraw");
    setTransactionHash(null);
    setTransactionStatus(null);
    let submitted = false;
    try {
      const hash = await writeContractAsync({
        chainId: AEVUM_CHAIN.id,
        address: contractAddress,
        abi: streamPayAbi,
        functionName: "withdrawFromStream",
        args: [stream.id, amount],
      });
      submitted = true;
      setTransactionHash(hash);
      setTransactionStatus("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("The withdrawal transaction reverted.");
      }
      submitted = false;
      setTransactionStatus("confirmed");
      setWithdrawInput("");
      setActionMessage("Withdrawal confirmed. Your wallet balance has been updated on-chain.");
      await onRefresh();
    } catch (error) {
      if (submitted) setTransactionStatus("failed");
      setActionError(transactionErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function cancelStream() {
    setActionError(null);
    setActionMessage(null);
    if (!canCancel) {
      setActionError("This stream cannot be cancelled by the connected wallet.");
      return;
    }
    if (!networkReady) {
      setActionError("Connect the sender wallet on QDay Aevum Testnet to cancel.");
      return;
    }

    setPendingAction("cancel");
    setTransactionHash(null);
    setTransactionStatus(null);
    let submitted = false;
    try {
      const hash = await writeContractAsync({
        chainId: AEVUM_CHAIN.id,
        address: contractAddress,
        abi: streamPayAbi,
        functionName: "cancelStream",
        args: [stream.id],
      });
      submitted = true;
      setTransactionHash(hash);
      setTransactionStatus("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("The cancellation transaction reverted.");
      }
      submitted = false;
      setTransactionStatus("confirmed");
      setConfirmCancel(false);
      setActionMessage(
        "Cancellation confirmed. Accrued tokens remain reserved for the recipient; only the unearned balance was refunded.",
      );
      await onRefresh();
    } catch (error) {
      if (submitted) setTransactionStatus("failed");
      setActionError(transactionErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        Back to streams
      </button>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Stream <span className="font-mono tabular-nums">#{stream.id.toString()}</span>
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{status}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${status === "Streaming" ? "bg-primary" : "bg-muted-foreground"}`} />
              {stream.cancelled ? "Accrual frozen" : "Aevum Testnet"}
            </span>
            <button
              type="button"
              onClick={() => void refreshConfirmedData()}
              disabled={isRefreshing || pendingAction !== null}
              aria-busy={isRefreshing}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            >
              <RefreshCw
                aria-hidden="true"
                size={14}
                className={isRefreshing ? "animate-spin motion-reduce:animate-none" : ""}
              />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Estimated accrued balance</p>
            <TokenAmount
              value={estimate}
              live
              className="mt-2 block break-all text-3xl font-semibold tracking-tight sm:text-4xl"
            />
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 aria-hidden="true" size={14} />
              Estimate anchored to block{" "}
              <span className="font-mono tabular-nums">{data.blockNumber.toString()}</span> ·
              reconciled with chain reads
            </p>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none"
                style={{ width: progressWidth }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{progress} complete</span>
              <span>{formatDuration(remaining)} remaining</span>
            </div>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <DetailMetric label="Confirmed accrued" value={stream.accrued} />
            <DetailMetric label="Confirmed withdrawable" value={stream.available} />
            <DetailMetric label="Estimated available" value={estimatedAvailable} estimated />
            <DetailMetric label="Withdrawn" value={stream.withdrawn} />
            <DetailMetric label="Remaining unaccrued" value={remainingUnaccrued} />
          </dl>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_.85fr]">
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h3 className="text-base font-semibold">Agreement</h3>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <AddressMetric label="Sender" address={stream.sender} />
            <AddressMetric label="Recipient" address={stream.recipient} />
            <StaticMetric
              label="Total deposit"
              value={`${formatTokenAmount(stream.deposit).display} tUSD8`}
              mono
            />
            <StaticMetric label="Rate per second" value={formatRatePerSecond(stream.deposit, duration)} mono />
            <StaticMetric label="Rate per hour" value={formatRatePerHour(stream.deposit, duration)} mono />
            <StaticMetric label="Start" value={formatDate(stream.startTime)} />
            <StaticMetric label="End" value={formatDate(stream.endTime)} />
            <StaticMetric
              label="Cancellation"
              value={stream.cancellable ? "Cancellable" : "Non-cancellable"}
            />
          </dl>
        </section>

        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 text-primary" />
            <div>
              <h3 className="text-base font-semibold">On-chain controls</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Only the recipient can withdraw earned tokens. A sender may reclaim unearned funds
                only when cancellation was enabled.
              </p>
            </div>
          </div>

          {isRecipient && (
            <form onSubmit={withdraw} className="space-y-3 border-t border-border pt-4">
              <label htmlFor="withdraw-amount" className="block text-sm font-medium">
                Amount to withdraw · tUSD8
              </label>
              <div className="flex gap-2">
                <input
                  id="withdraw-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={withdrawInput}
                  onChange={(event) => {
                    setWithdrawInput(event.target.value);
                    setWithdrawError(null);
                  }}
                  placeholder="0.00"
                  className="form-input min-w-0 flex-1 font-mono tabular-nums text-sm"
                  aria-invalid={withdrawError ? "true" : undefined}
                  aria-describedby={
                    withdrawError ? "withdraw-help withdraw-error" : "withdraw-help"
                  }
                />
                <button
                  type="button"
                  onClick={() => setWithdrawInput(formatTokenAmount(stream.available).raw)}
                  disabled={stream.available === BigInt(0)}
                  className="min-h-11 rounded-xl border border-border px-3 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                >
                  Max
                </button>
              </div>
              <p id="withdraw-help" className="text-xs text-muted-foreground">
                Available now: {formatTokenAmount(stream.available).display} tUSD8 (confirmed on-chain)
              </p>
              {withdrawError && (
                <p id="withdraw-error" className="text-xs text-destructive">
                  {withdrawError}
                </p>
              )}
              <button
                type="submit"
                disabled={!networkReady || pendingAction !== null || stream.available === BigInt(0)}
                aria-busy={pendingAction === "withdraw"}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "withdraw" && (
                  <LoaderCircle
                    aria-hidden="true"
                    size={16}
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                {pendingAction === "withdraw" ? "Withdrawal pending…" : "Withdraw tokens"}
              </button>
            </form>
          )}

          {canCancel && (
            <div className="space-y-3 border-t border-border pt-4">
              {!confirmCancel ? (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  disabled={pendingAction !== null}
                  className="min-h-11 w-full rounded-xl border border-destructive/50 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Cancel stream
                </button>
              ) : (
                <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                  <p className="text-sm leading-6">
                    Cancel this stream? The recipient keeps all accrued tokens; only the unearned
                    balance is refunded.
                  </p>
                  <dl className="grid gap-2 rounded-lg border border-border/70 bg-background/70 p-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Accrued · estimate</dt>
                      <dd className="mt-1 font-mono tabular-nums">
                        {formatTokenAmount(estimate).display} tUSD8
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Refund · estimate</dt>
                      <dd className="mt-1 font-mono tabular-nums">
                        {formatTokenAmount(remainingUnaccrued).display} tUSD8
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Final amounts are determined by the block timestamp when cancellation is
                    confirmed.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(false)}
                      disabled={pendingAction !== null}
                      className="min-h-10 flex-1 rounded-lg border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Keep stream
                    </button>
                    <button
                      type="button"
                      onClick={cancelStream}
                      disabled={!networkReady || pendingAction !== null}
                      aria-busy={pendingAction === "cancel"}
                      className="min-h-10 flex-1 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                    >
                      {pendingAction === "cancel" ? "Cancelling…" : "Confirm cancellation"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isRecipient && !canCancel && (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">
              No action is available to this wallet for this stream.
            </p>
          )}
        </section>
      </div>

      {actionError && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm leading-6 text-destructive">
          <AlertCircle aria-hidden="true" size={17} className="mt-1 shrink-0" />
          {actionError}
        </p>
      )}
      {actionMessage && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm leading-6 text-foreground">
          <Check aria-hidden="true" size={17} className="mt-1 shrink-0 text-primary" />
          {actionMessage}
        </p>
      )}
      {transactionHash && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
          <span className="break-all font-mono text-xs text-muted-foreground">
            {transactionStatus === "pending"
              ? "Submitted transaction"
              : transactionStatus === "failed"
                ? "Failed transaction"
                : "Confirmed transaction"}
            : {shortAddress(transactionHash)}
          </span>
          <a
            href="https://explorer-test.qday.info"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center gap-2 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open official explorer
            <ArrowUpRight aria-hidden="true" size={14} />
          </a>
        </div>
      )}
    </div>
  );
}

function DetailMetric({
  label,
  value,
  estimated = false,
}: Readonly<{ label: string; value: bigint; estimated?: boolean }>) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background p-3">
      <dt className="text-xs text-muted-foreground">
        {label}
        {estimated && " · estimate"}
      </dt>
      <dd className="mt-1 break-all font-mono text-sm tabular-nums">
        <TokenAmount value={value} />
        <span className="ml-1 text-xs text-muted-foreground">tUSD8</span>
      </dd>
    </div>
  );
}

function AddressMetric({ label, address }: Readonly<{ label: string; address: Address }>) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-1">
        <span className="font-mono text-sm" title={address}>{shortAddress(address)}</span>
        <button
          type="button"
          onClick={copyAddress}
          aria-label={`Copy ${label.toLowerCase()} address`}
          className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : <Copy aria-hidden="true" size={13} />}
        </button>
        <a
          href="https://explorer-test.qday.info"
          target="_blank"
          rel="noreferrer"
          aria-label="Open official QDay testnet explorer"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ExternalLink aria-hidden="true" size={13} />
        </a>
        {copyState === "failed" && (
          <span role="status" className="text-xs text-destructive">Clipboard unavailable</span>
        )}
      </dd>
    </div>
  );
}

function StaticMetric({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

function transactionErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "The wallet transaction could not be completed.";
  if (/user rejected|denied transaction|rejected the request/i.test(message)) {
    return "Transaction rejected in wallet. No stream state changed; review and try again.";
  }
  return message;
}
