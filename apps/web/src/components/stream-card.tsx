"use client";

import { useState } from "react";
import { ArrowUpRight, Copy, ExternalLink } from "lucide-react";
import type { Address } from "viem";
import { estimateAccrued, formatPercent, shortAddress } from "@/lib/numbers";
import type { StreamRecord, WalletData } from "@/lib/streams";
import { TokenAmount } from "@/components/token-amount";

interface StreamCardProps {
  stream: StreamRecord;
  role: "incoming" | "outgoing";
  data: WalletData;
  nowMs: number;
  onSelect: (streamId: bigint) => void;
}

export function StreamCard({
  stream,
  role,
  data,
  nowMs,
  onSelect,
}: StreamCardProps) {
  const counterparty = role === "incoming" ? stream.sender : stream.recipient;
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
  const elapsedSeconds = BigInt(Math.max(0, Math.floor((nowMs - data.fetchedAtMs) / 1000)));
  const estimatedChainTime = data.blockTimestamp + elapsedSeconds;
  const stopTime = stream.cancelled
    ? stream.cancelledAt
    : estimatedChainTime < stream.endTime
      ? estimatedChainTime
      : stream.endTime;
  const elapsed = stopTime > stream.startTime ? stopTime - stream.startTime : BigInt(0);
  const duration = stream.endTime - stream.startTime;
  const progress = formatPercent(elapsed, duration);
  const progressWidth = `${progress === "--" ? "0" : progress.slice(0, -1)}%`;
  const status = stream.cancelled
    ? "Cancelled"
    : estimatedChainTime >= stream.endTime
      ? "Completed"
      : estimatedChainTime < stream.startTime
        ? "Scheduled"
        : "Streaming";

  return (
    <article className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {role === "incoming" ? "Incoming from" : "Outgoing to"} · Stream{" "}
            <span className="font-mono tabular-nums">#{stream.id.toString()}</span>
          </p>
          <AddressCopy address={counterparty} label={role === "incoming" ? "sender" : "recipient"} />
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <span
            className={`h-2 w-2 rounded-full ${status === "Streaming" ? "bg-primary" : "bg-muted-foreground"}`}
            aria-hidden="true"
          />
          {status}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Total deposit</p>
          <p className="mt-1 break-all text-lg font-semibold">
            <TokenAmount value={stream.deposit} />
            <span className="ml-1 text-xs font-normal text-muted-foreground">tUSD8</span>
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Accrued · estimate</p>
          <p className="mt-1 break-all text-lg font-semibold">
            <TokenAmount value={estimate} live />
            <span className="ml-1 text-xs font-normal text-muted-foreground">tUSD8</span>
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {role === "incoming" ? "Withdrawable · confirmed" : "Withdrawn"}
          </p>
          <p className="mt-1 break-all text-lg font-semibold">
            <TokenAmount value={role === "incoming" ? stream.available : stream.withdrawn} />
            <span className="ml-1 text-xs font-normal text-muted-foreground">tUSD8</span>
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label={`Stream ${stream.id.toString()} accrual progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === "--" ? 0 : Number(progress.slice(0, -1))}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none"
            style={{ width: progressWidth }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{progress} elapsed</span>
          <span>{role === "incoming" ? "Earned tokens are withdrawable by recipient" : "Funded at creation"}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {stream.cancelled
            ? "Accrual stopped when the sender cancelled."
            : role === "incoming"
              ? "You are the recipient."
              : "You are the sender."}
        </p>
        <button
          type="button"
          onClick={() => onSelect(stream.id)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View details
          <ArrowUpRight aria-hidden="true" size={15} />
        </button>
      </div>
    </article>
  );
}

function AddressCopy({ address, label }: Readonly<{ address: Address; label: string }>) {
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
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm" title={address}>
        {shortAddress(address)}
      </span>
      <button
        type="button"
        onClick={copyAddress}
        aria-label={`Copy ${label} address`}
        className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : <Copy aria-hidden="true" size={14} />}
      </button>
      <a
        href="https://explorer-test.qday.info"
        target="_blank"
        rel="noreferrer"
        aria-label="Open official QDay testnet explorer"
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ExternalLink aria-hidden="true" size={14} />
      </a>
      {copyState === "failed" && (
        <span role="status" className="text-xs text-destructive">
          Clipboard unavailable
        </span>
      )}
    </div>
  );
}
