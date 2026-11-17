"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Wallet, X } from "lucide-react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/numbers";

export function WalletConnect({ compact = false }: Readonly<{ compact?: boolean }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect, connectors, error, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [availableConnectors, setAvailableConnectors] =
    useState<typeof connectors>([]);
  const [checkingConnectors, setCheckingConnectors] = useState(false);
  const [connectorCheckError, setConnectorCheckError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (isConnected) dialogRef.current?.close();
  }, [isConnected]);

  useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all(
      connectors.map(async (connector) => {
        try {
          const provider = await connector.getProvider();
          return provider ? connector : null;
        } catch (error) {
          if (error instanceof Error && /provider not found/i.test(error.message)) {
            return null;
          }
          throw error;
        }
      }),
    )
      .then((results) => {
        if (active) {
          setAvailableConnectors(results.filter((connector) => connector !== null));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setConnectorCheckError(
            error instanceof Error
              ? error.message
              : "Could not check for compatible wallets. Try again.",
          );
        }
      })
      .finally(() => {
        if (active) setCheckingConnectors(false);
      });
    return () => {
      active = false;
    };
  }, [connectors, open]);

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden rounded-full border border-border bg-card px-3 py-2 font-mono text-xs text-foreground sm:inline">
          {shortAddress(address)}
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            disconnect();
          }}
          className="min-h-10 rounded-full border border-border px-3 text-sm text-muted-foreground motion-safe:transition-colors motion-safe:duration-100 hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAvailableConnectors([]);
          setCheckingConnectors(true);
          setConnectorCheckError(null);
          setOpen(true);
        }}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground motion-safe:transition-colors motion-safe:duration-100 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
          compact ? "px-3 sm:px-5" : "px-5"
        }`}
        aria-label="Connect wallet"
      >
        <Wallet aria-hidden="true" size={16} />
        {compact ? (
          <span className="hidden min-[400px]:inline">Connect</span>
        ) : (
          "Connect wallet"
        )}
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => {
          setOpen(false);
          setCheckingConnectors(false);
        }}
        onCancel={() => {
          setOpen(false);
          setCheckingConnectors(false);
        }}
        aria-labelledby="wallet-dialog-title"
        className="w-[min(92vw,420px)] rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-background/70"
      >
        <div className="flex items-start justify-between border-b border-border p-6">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Wallet connection
            </p>
            <h2 id="wallet-dialog-title" className="text-xl font-semibold tracking-tight">
              Connect to StreamPay
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close wallet connection dialog"
            onClick={() => setOpen(false)}
            className="grid min-h-10 min-w-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Connect an EVM wallet. StreamPay never asks for a seed phrase or private key.
          </p>
          {checkingConnectors && (
            <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
              Checking for compatible wallets…
            </p>
          )}
          {availableConnectors.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              disabled={isPending}
              onClick={() => connect({ connector })}
              aria-busy={isPending}
              className="flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-background px-4 text-left text-sm font-medium motion-safe:transition-colors motion-safe:duration-100 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60"
            >
              <span>{isPending ? "Waiting for wallet…" : connector.name}</span>
              <ArrowDownToLine aria-hidden="true" size={16} className="text-muted-foreground" />
            </button>
          ))}
          {!checkingConnectors && availableConnectors.length === 0 && !connectorCheckError && (
            <p className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
              No injected wallet was found. Install MetaMask or another compatible EVM wallet, then
              reload this page.
            </p>
          )}
          {connectorCheckError && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {connectorCheckError}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {/provider not found/i.test(error.message)
                ? "No compatible wallet was detected. Install a wallet extension, then reload this page."
                : error.message}
            </p>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            This app uses testnet tokens with no monetary value.
          </p>
        </div>
      </dialog>
    </>
  );
}
