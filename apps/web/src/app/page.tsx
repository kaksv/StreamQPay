"use client";

/* ─────────────────────────────────────────────────────────
 * PAGE CONTENT STORYBOARD
 *
 * Header and primary action stay visible immediately.
 * Only dashboard content cascades in after mount.
 *
 *   100ms  account summary settles into place
 *   280ms  stream workspace appears
 *   460ms  recent activity appears
 * ───────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Wallet,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import type { Address } from "viem";
import { CreateStreamForm } from "@/components/create-stream-form";
import { StreamCard } from "@/components/stream-card";
import { StreamDetail } from "@/components/stream-detail";
import { TokenAmount } from "@/components/token-amount";
import { WalletConnect } from "@/components/wallet-connect";
import { AEVUM_CHAIN, getStreamPayAddress } from "@/lib/chain";
import {
  estimateAccrued,
  formatDate,
  shortAddress,
} from "@/lib/numbers";
import { fetchTokenBalance, fetchWalletData, type ActivityRecord } from "@/lib/streams";

const TIMING = {
  summary: 100,
  streams: 280,
  activity: 460,
} as const;

const PAGE_SPRING = { type: "spring" as const, stiffness: 350, damping: 28 };
const ONE_SECOND_MS = 1_000;
const REFRESH_INTERVAL_MS = 15_000;
const THEME_CHANGE_EVENT = "streampay-theme-change";

type DashboardView = "dashboard" | "create";
type StreamFilter = "all" | "incoming" | "outgoing";

function subscribeToTheme(listener: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, listener);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, listener);
}

function getThemeSnapshot() {
  return document.documentElement.classList.contains("dark");
}

function getServerThemeSnapshot() {
  return true;
}

export default function Home() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const reducedMotion = useReducedMotion();
  const [view, setView] = useState<DashboardView>("dashboard");
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [selectedStreamId, setSelectedStreamId] = useState<bigint | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [stage, setStage] = useState(0);
  const isDark = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);

  const appConfig = useMemo(() => {
    try {
      const contractAddress = getStreamPayAddress();
      return contractAddress
        ? { contractAddress, error: null }
        : {
            contractAddress: null,
            error: "Set NEXT_PUBLIC_STREAMPAY_ADDRESS to the verified StreamPay contract address.",
          };
    } catch (error) {
      return {
        contractAddress: null,
        error: error instanceof Error ? error.message : "The StreamPay contract address is invalid.",
      };
    }
  }, []);

  const walletDataQuery = useQuery({
    queryKey: ["wallet-data", address?.toLowerCase(), appConfig.contractAddress],
    queryFn: () => {
      if (!address) throw new Error("Connect a wallet to load stream data.");
      return fetchWalletData(address);
    },
    enabled: Boolean(address && appConfig.contractAddress),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const tokenBalanceQuery = useQuery({
    queryKey: ["tusd8-balance", address?.toLowerCase()],
    queryFn: () => {
      if (!address) throw new Error("Connect a wallet to load its tUSD8 balance.");
      return fetchTokenBalance(address);
    },
    enabled: Boolean(address),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), ONE_SECOND_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timers = [
      setTimeout(() => setStage(1), TIMING.summary),
      setTimeout(() => setStage(2), TIMING.streams),
      setTimeout(() => setStage(3), TIMING.activity),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("streampay-theme");
    const dark = savedTheme !== "light";
    document.documentElement.classList.toggle("dark", dark);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const networkReady = Boolean(isConnected && address && chainId === AEVUM_CHAIN.id);
  const dashboardData = walletDataQuery.data;
  const streams = dashboardData?.streams ?? [];
  const incoming = address
    ? streams.filter((stream) => stream.recipient.toLowerCase() === address.toLowerCase())
    : [];
  const outgoing = address
    ? streams.filter((stream) => stream.sender.toLowerCase() === address.toLowerCase())
    : [];
  const filteredStreams =
    filter === "incoming"
      ? incoming.map((stream) => ({ stream, role: "incoming" as const }))
      : filter === "outgoing"
        ? outgoing.map((stream) => ({ stream, role: "outgoing" as const }))
        : streams.map((stream) => ({
            stream,
            role:
              stream.recipient.toLowerCase() === address?.toLowerCase()
                ? ("incoming" as const)
                : ("outgoing" as const),
          }));
  const selectedStream = selectedStreamId
    ? streams.find((stream) => stream.id === selectedStreamId)
    : undefined;
  const withdrawableTotal = incoming.reduce((total, stream) => total + stream.available, BigInt(0));
  const accruedTotal = dashboardData
    ? incoming.reduce(
        (total, stream) =>
          total +
          estimateAccrued(
            stream.deposit,
            stream.startTime,
            stream.endTime,
            stream.cancelledAt,
            stream.cancelled,
            dashboardData.blockTimestamp,
            dashboardData.fetchedAtMs,
            nowMs || dashboardData.fetchedAtMs,
          ),
        BigInt(0),
      )
    : BigInt(0);

  async function refreshDashboard(): Promise<void> {
    await Promise.all([walletDataQuery.refetch(), tokenBalanceQuery.refetch()]);
  }

  function showDashboard() {
    setSelectedStreamId(null);
    setView("dashboard");
  }

  function toggleTheme() {
    const nextIsDark = !isDark;
    document.documentElement.classList.toggle("dark", nextIsDark);
    window.localStorage.setItem("streampay-theme", nextIsDark ? "dark" : "light");
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg pr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:gap-3"
            aria-label="StreamPay dashboard"
          >
            <span className="hidden h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground min-[360px]:grid">
              <span className="text-sm font-bold" aria-hidden="true">S</span>
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">StreamPay</span>
              <span className="hidden text-xs text-muted-foreground min-[400px]:block">
                Payments that flow with time
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden min-h-10 items-center gap-2 rounded-full border border-border px-3 text-xs text-muted-foreground sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              QDay Aevum Testnet
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
              aria-pressed={isDark}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:transition-colors motion-safe:duration-100"
            >
              {isDark ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
            </button>
            <WalletConnect compact />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {!isConnected || !address ? (
          <section className="grid min-h-[55vh] place-items-center">
            <div className="max-w-xl text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border bg-card">
                <Wallet aria-hidden="true" className="text-primary" size={24} />
              </div>
              <p className="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Non-custodial tUSD8 streams
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Send payments that accrue with time.
              </h1>
              <p className="mx-auto mt-4 max-w-prose text-sm leading-6 text-muted-foreground">
                Fund a stream once. Recipients withdraw earned tUSD8 at any time on QDay Aevum
                Testnet.
              </p>
              <div className="mt-6 flex justify-center">
                <WalletConnect />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Testnet tokens have no monetary value. StreamPay never holds your wallet keys.
              </p>
            </div>
          </section>
        ) : (
          <>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Your streams
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Payment dashboard</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Manage incoming and outgoing tUSD8 streams.
                </p>
              </div>
              {view === "dashboard" && !selectedStream && (
                <button
                  type="button"
                  onClick={() => setView("create")}
                  disabled={!appConfig.contractAddress}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus aria-hidden="true" size={17} />
                  New stream
                </button>
              )}
            </div>

            {appConfig.error && (
              <div
                role="alert"
                className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm sm:flex-row sm:items-start"
              >
                <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">StreamPay is not configured for this deployment.</p>
                  <p className="mt-1 break-words leading-6 text-muted-foreground">{appConfig.error}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ask the project administrator to configure the verified contract address and deployment block.
                  </p>
                </div>
              </div>
            )}

            {!networkReady && (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Switch to QDay Aevum Testnet to sign transactions.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Read-only data remains tied to the configured Aevum RPC.
                  </p>
                  {switchError && (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      {switchError.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => switchChain({ chainId: AEVUM_CHAIN.id })}
                  disabled={isSwitching}
                  aria-busy={isSwitching}
                  className="min-h-11 shrink-0 rounded-xl border border-border px-4 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                >
                  {isSwitching ? "Switching network…" : "Switch network"}
                </button>
              </div>
            )}

            {view === "create" && appConfig.contractAddress ? (
              <section className="rounded-2xl border border-border bg-card p-5 sm:p-7">
                <div className="mb-6">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    New agreement
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight">Create a stream</h2>
                </div>
                <CreateStreamForm
                  contractAddress={appConfig.contractAddress}
                  walletAddress={address}
                  networkReady={networkReady}
                  onCancel={showDashboard}
                  onCreated={() => {
                    void refreshDashboard();
                  }}
                />
              </section>
            ) : selectedStream && dashboardData && address && appConfig.contractAddress ? (
              <StreamDetail
                stream={selectedStream}
                data={dashboardData}
                nowMs={nowMs || dashboardData.fetchedAtMs}
                walletAddress={address}
                contractAddress={appConfig.contractAddress}
                networkReady={networkReady}
                onBack={showDashboard}
                onRefresh={refreshDashboard}
              />
            ) : selectedStreamId !== null && dashboardData ? (
              <section className="rounded-xl border border-border bg-card p-5">
                <p className="text-sm font-medium">This stream is no longer in the loaded history.</p>
                <p className="mt-1 text-sm text-muted-foreground">Refresh the dashboard or return to your stream list.</p>
                <button
                  type="button"
                  onClick={showDashboard}
                  className="mt-4 min-h-10 rounded-lg border border-border px-4 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Back to streams
                </button>
              </section>
            ) : view === "dashboard" ? (
              <>
                <Reveal stage={stage} threshold={1} offsetY={12}>
                  <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <SummaryCard
                      label="Wallet tUSD8 balance"
                      value={
                        tokenBalanceQuery.data === undefined
                          ? null
                          : <TokenAmount value={tokenBalanceQuery.data} />
                      }
                      footnote={address ? `Wallet ${shortAddress(address)}` : "Wallet not connected"}
                      loading={tokenBalanceQuery.isLoading}
                      error={tokenBalanceQuery.error?.message}
                      onRetry={() => void tokenBalanceQuery.refetch()}
                    />
                    <SummaryCard
                      label="Incoming · withdrawable"
                      value={dashboardData ? <TokenAmount value={withdrawableTotal} /> : null}
                      footnote="Confirmed by the latest Aevum block"
                      loading={walletDataQuery.isLoading}
                    />
                    <SummaryCard
                      label="Incoming · accrued estimate"
                      value={dashboardData ? <TokenAmount value={accruedTotal} live /> : null}
                      footnote={
                        dashboardData
                          ? `Estimate anchored to block ${dashboardData.blockNumber.toString()}`
                          : "Updates from on-chain stream terms"
                      }
                      loading={walletDataQuery.isLoading}
                    />
                  </section>
                </Reveal>

                <Reveal stage={stage} threshold={2} offsetY={16}>
                  <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold">Streams</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Withdraw earned tokens or review active agreements.
                        </p>
                      </div>
                      <div className="flex min-h-10 items-center gap-1 rounded-xl border border-border bg-background p-1" role="group" aria-label="Filter streams">
                        {(["all", "incoming", "outgoing"] as const).map((value) => (
                          <button
                            type="button"
                            key={value}
                            onClick={() => setFilter(value)}
                            aria-pressed={filter === value}
                            className={`min-h-9 rounded-lg px-3 text-xs font-medium capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                              filter === value
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            }`}
                          >
                            {value}
                            {value === "incoming"
                              ? ` (${incoming.length})`
                              : value === "outgoing"
                                ? ` (${outgoing.length})`
                                : ` (${streams.length})`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {walletDataQuery.isLoading && (
                      <div className="mt-6 grid gap-3" aria-label="Loading streams" aria-busy="true">
                        {Array.from({ length: 3 }, (_, index) => (
                          <div
                            key={index}
                            className="h-48 animate-pulse rounded-2xl border border-border bg-background motion-reduce:animate-none"
                          />
                        ))}
                      </div>
                    )}

                    {walletDataQuery.error && (
                      <div role="alert" className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                        <div className="flex items-start gap-2 text-sm text-destructive">
                          <AlertCircle aria-hidden="true" size={17} className="mt-0.5 shrink-0" />
                          <div>
                            <p className="font-medium">Couldn’t load your streams.</p>
                            <p className="mt-1 break-words text-xs leading-5">{walletDataQuery.error.message}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void walletDataQuery.refetch()}
                          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <RefreshCw aria-hidden="true" size={13} />
                          Try again
                        </button>
                      </div>
                    )}

                    {dashboardData && filteredStreams.length === 0 && !walletDataQuery.isLoading && (
                      <div className="mt-6 grid place-items-center rounded-xl border border-dashed border-border bg-background px-5 py-12 text-center">
                        <div className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card">
                          <Clock3 aria-hidden="true" className="text-muted-foreground" size={19} />
                        </div>
                        <h3 className="mt-4 text-sm font-medium">
                          {streams.length === 0 ? "No streams yet" : `No ${filter} streams`}
                        </h3>
                        <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                          {streams.length === 0
                            ? "Create your first payment stream or ask someone to stream tUSD8 to this wallet."
                            : "Try another filter to see the rest of your agreements."}
                        </p>
                        {streams.length === 0 && (
                          <button
                            type="button"
                            onClick={() => setView("create")}
                            disabled={!appConfig.contractAddress}
                            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                          >
                            <Plus aria-hidden="true" size={16} />
                            Create a stream
                          </button>
                        )}
                      </div>
                    )}

                    {dashboardData && filteredStreams.length > 0 && (
                      <div className="mt-6 grid gap-3">
                        {filteredStreams.map(({ stream, role }) => (
                          <StreamCard
                            key={stream.id.toString()}
                            stream={stream}
                            role={role}
                            data={dashboardData}
                            nowMs={nowMs || dashboardData.fetchedAtMs}
                            onSelect={setSelectedStreamId}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </Reveal>

                <Reveal stage={stage} threshold={3} offsetY={16}>
                      <ActivityPanel
                        activity={dashboardData?.activity ?? []}
                        walletAddress={address}
                        isLoading={walletDataQuery.isLoading}
                        error={walletDataQuery.error?.message}
                        onRetry={() => void walletDataQuery.refetch()}
                      />
                </Reveal>

                {walletDataQuery.isFetching && !walletDataQuery.isLoading && (
                  <p role="status" className="text-right text-xs text-muted-foreground">
                    Updating from QDay Aevum Testnet…
                  </p>
                )}
              </>
            ) : null}
          </>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>StreamPay · Non-custodial tUSD8 streams · Testnet only</p>
          <a
            href="https://explorer-test.qday.info"
            target="_blank"
            rel="noreferrer"
            className="min-h-10 inline-flex items-center gap-2 self-start underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:self-auto"
          >
            QDay testnet explorer
            <ArrowUpRight aria-hidden="true" size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}

function Reveal({
  children,
  stage,
  threshold,
  offsetY,
}: Readonly<{ children: ReactNode; stage: number; threshold: number; offsetY: number }>) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: offsetY }}
      animate={
        reducedMotion || stage >= threshold
          ? { opacity: 1, y: 0 }
          : { opacity: 0, y: offsetY }
      }
      transition={
        reducedMotion
          ? { duration: 0 }
          : PAGE_SPRING
      }
    >
      {children}
    </motion.div>
  );
}

function SummaryCard({
  label,
  value,
  footnote,
  loading = false,
  error,
  onRetry,
}: Readonly<{
  label: string;
  value: ReactNode | null;
  footnote: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}>) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      {loading ? (
        <div className="mt-3 h-8 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      ) : error ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-destructive">Balance unavailable</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-10 rounded-lg px-2 text-xs underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 break-all text-2xl font-semibold tracking-tight">{value ?? "--"}</p>
      )}
      <p className="mt-2 break-words text-xs text-muted-foreground">{footnote}</p>
    </section>
  );
}

function ActivityPanel({
  activity,
  walletAddress,
  isLoading,
  error,
  onRetry,
}: Readonly<{
  activity: ActivityRecord[];
  walletAddress: Address;
  isLoading: boolean;
  error?: string;
  onRetry: () => void;
}>) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">Latest confirmed stream events.</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          On-chain history
        </span>
      </div>

      {isLoading ? (
        <div className="mt-5 space-y-3" aria-busy="true" aria-label="Loading recent activity">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl bg-background motion-reduce:animate-none" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Couldn’t load recent activity.</p>
          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 min-h-10 rounded-lg px-2 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Try again
          </button>
        </div>
      ) : activity.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
          No confirmed stream activity yet. New streams and withdrawals will appear here.
        </p>
      ) : (
        <ol className="mt-5 divide-y divide-border">
          {[...activity].reverse().map((entry) => (
            <ActivityRow
              key={`${entry.transactionHash}-${entry.logIndex}`}
              event={entry}
              walletAddress={walletAddress}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityRow({
  event,
  walletAddress,
}: Readonly<{ event: ActivityRecord; walletAddress: Address }>) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const isIncoming = walletAddress.toLowerCase() === event.recipient.toLowerCase();
  const counterparty = isIncoming ? event.sender : event.recipient;
  const label =
    event.kind === "created"
      ? isIncoming
        ? "Stream received"
        : "Stream created"
      : event.kind === "withdrawn"
        ? isIncoming
          ? "Tokens withdrawn"
          : "Recipient withdrew"
        : isIncoming
          ? "Sender cancelled"
          : "Stream cancelled · refund";
  const Icon =
    event.kind === "cancelled"
      ? Check
      : isIncoming
        ? ArrowDownLeft
        : ArrowUpRight;
  const amountLabel =
    event.kind === "cancelled"
      ? "Refunded to sender"
      : event.kind === "created"
        ? "Funded"
        : "Withdrawn";

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(event.transactionHash);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-background text-primary">
          <Icon aria-hidden="true" size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Stream <span className="font-mono tabular-nums">#{event.id.toString()}</span> ·{" "}
            {formatDate(event.timestamp)} · {shortAddress(counterparty)}
          </p>
          <div className="mt-1 flex items-center gap-1">
            <span className="font-mono text-xs text-muted-foreground" title={event.transactionHash}>
              {shortAddress(event.transactionHash)}
            </span>
            <button
              type="button"
              onClick={copyHash}
              aria-label="Copy transaction hash"
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : <Copy aria-hidden="true" size={13} />}
            </button>
            {copyState === "failed" && (
              <span role="status" className="text-xs text-destructive">Clipboard unavailable</span>
            )}
          </div>
        </div>
      </div>
      <p className="shrink-0 text-sm font-medium sm:text-right">
        <span className="mr-1 text-xs text-muted-foreground">{amountLabel}</span>
        <TokenAmount value={event.amount} />
        <span className="ml-1 text-xs text-muted-foreground">tUSD8</span>
      </p>
    </li>
  );
}
