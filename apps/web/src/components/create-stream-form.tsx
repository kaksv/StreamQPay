"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronRight, LoaderCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWriteContract } from "wagmi";
import {
  formatUnits,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi, streamPayAbi } from "@/lib/abi";
import { AEVUM_CHAIN, publicClient, TUSD8_ADDRESS } from "@/lib/chain";
import {
  formatDate,
  formatDuration,
  formatRatePerHour,
  formatRatePerSecond,
  formatTokenAmount,
  parseTokenAmount,
} from "@/lib/numbers";
import { fetchTokenBalance } from "@/lib/streams";

type DurationUnit = "seconds" | "minutes" | "hours" | "days";
type Step = "form" | "review" | "approving" | "creating" | "success";

const durationMultipliers: Record<DurationUnit, bigint> = {
  seconds: BigInt(1),
  minutes: BigInt(60),
  hours: BigInt(3_600),
  days: BigInt(86_400),
};
const MAX_UINT64 = BigInt(2) ** BigInt(64) - BigInt(1);

interface CreateStreamFormProps {
  contractAddress: Address;
  walletAddress: Address;
  networkReady: boolean;
  onCancel: () => void;
  onCreated: () => void;
}

interface StreamInput {
  recipient: Address;
  amount: bigint;
  duration: bigint;
}

export function CreateStreamForm({
  contractAddress,
  walletAddress,
  networkReady,
  onCancel,
  onCreated,
}: CreateStreamFormProps) {
  const { writeContractAsync } = useWriteContract();
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [durationInput, setDurationInput] = useState("30");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("days");
  const [cancellable, setCancellable] = useState(true);
  const [step, setStep] = useState<Step>("form");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewedInput, setReviewedInput] = useState<StreamInput | null>(null);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txStatus, setTxStatus] = useState<"pending" | "confirmed" | "failed" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"recipient" | "amount" | "duration", string>>
  >({});

  const balanceQuery = useQuery({
    queryKey: ["create-stream-balances", walletAddress, contractAddress],
    queryFn: async () => {
      const [tokenBalance, allowance, gasBalance] = await Promise.all([
        fetchTokenBalance(walletAddress),
        publicClient.readContract({
          address: TUSD8_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [walletAddress, contractAddress],
        }),
        publicClient.getBalance({ address: walletAddress }),
      ]);
      return { tokenBalance, allowance, gasBalance };
    },
    enabled: networkReady,
    refetchInterval: 15_000,
  });

  const blockQuery = useQuery({
    queryKey: ["create-stream-latest-block"],
    queryFn: () => publicClient.getBlock({ blockTag: "latest" }),
    enabled: networkReady,
    refetchInterval: 10_000,
  });

  const inputError = useMemo(() => {
    if (!reviewedInput) return null;
    if (
      balanceQuery.data &&
      reviewedInput.amount > balanceQuery.data.tokenBalance
    ) {
      return "Your tUSD8 balance is below the stream amount.";
    }
    return null;
  }, [balanceQuery.data, reviewedInput]);

  function parseForm(): StreamInput | null {
    setFormError(null);
    setFieldErrors({});
    if (!isAddress(recipientInput.trim())) {
      const message = "Enter a valid EVM recipient address.";
      setFormError(message);
      setFieldErrors({ recipient: message });
      return null;
    }
    const recipient = getAddress(recipientInput.trim());
    if (recipient === "0x0000000000000000000000000000000000000000") {
      const message = "The zero address cannot receive a stream.";
      setFormError(message);
      setFieldErrors({ recipient: message });
      return null;
    }
    if (!/^\d+(?:\.\d{1,6})?$/.test(amountInput.trim())) {
      const message = "Enter an amount with up to 6 decimal places.";
      setFormError(message);
      setFieldErrors({ amount: message });
      return null;
    }
    if (!/^\d+$/.test(durationInput.trim()) || durationInput.trim().length > 20) {
      const message = "Enter a whole-number duration within the supported range.";
      setFormError(message);
      setFieldErrors({ duration: message });
      return null;
    }

    let amount: bigint;
    try {
      amount = parseTokenAmount(amountInput);
    } catch {
      const message = "Enter a valid tUSD8 amount.";
      setFormError(message);
      setFieldErrors({ amount: message });
      return null;
    }
    const duration = BigInt(durationInput) * durationMultipliers[durationUnit];
    if (amount <= BigInt(0)) {
      const message = "The stream amount must be greater than zero.";
      setFormError(message);
      setFieldErrors({ amount: message });
      return null;
    }
    if (duration <= BigInt(0) || duration > MAX_UINT64) {
      const message = "Choose a duration that fits the supported time range.";
      setFormError(message);
      setFieldErrors({ duration: message });
      return null;
    }
    if (balanceQuery.data && amount > balanceQuery.data.tokenBalance) {
      const message = "Your tUSD8 balance is below the stream amount.";
      setFormError(message);
      setFieldErrors({ amount: message });
      return null;
    }

    return { recipient, amount, duration };
  }

  function reviewStream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!networkReady) {
      setFormError("Switch to QDay Aevum Testnet before creating a stream.");
      return;
    }
    const parsed = parseForm();
    if (parsed) {
      setReviewedInput(parsed);
      setStep("review");
    }
  }

  async function createStream() {
    if (!reviewedInput || !networkReady) {
      setFormError("Reconnect your wallet on QDay Aevum Testnet, then try again.");
      return;
    }
    setFormError(null);
    setTxHash(null);
    setTxStatus(null);
    setIsSubmitting(true);
    let submitted = false;

    try {
      const currentAllowance =
        balanceQuery.data?.allowance ??
        (await publicClient.readContract({
          address: TUSD8_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [walletAddress, contractAddress],
        }));

      if (currentAllowance < reviewedInput.amount) {
        setStep("approving");
        const approvalHash = await writeContractAsync({
          chainId: AEVUM_CHAIN.id,
          address: TUSD8_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [contractAddress, reviewedInput.amount],
        });
        submitted = true;
        setTxHash(approvalHash);
        setTxStatus("pending");
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
        });
        if (approvalReceipt.status !== "success") {
          throw new Error("The tUSD8 approval transaction reverted.");
        }
        submitted = false;
        setTxStatus("confirmed");
        setApprovalConfirmed(true);
        await balanceQuery.refetch();
      } else {
        setApprovalConfirmed(true);
      }

      setStep("creating");
      setTxHash(null);
      setTxStatus(null);
      submitted = false;
      const createHash = await writeContractAsync({
        chainId: AEVUM_CHAIN.id,
        address: contractAddress,
        abi: streamPayAbi,
        functionName: "createStream",
        args: [
          reviewedInput.recipient,
          reviewedInput.amount,
          reviewedInput.duration,
          cancellable,
        ],
      });
      submitted = true;
      setTxHash(createHash);
      setTxStatus("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      if (receipt.status !== "success") {
        throw new Error("The stream creation transaction reverted.");
      }
      submitted = false;
      setTxStatus("confirmed");

      setStep("success");
      onCreated();
    } catch (error) {
      if (submitted) setTxStatus("failed");
      setFormError(transactionErrorMessage(error));
      setStep("review");
    } finally {
      setIsSubmitting(false);
    }
  }

  const review = reviewedInput;
  const enoughAllowance =
    review !== null &&
    balanceQuery.data !== undefined &&
    balanceQuery.data.allowance >= review.amount;
  const startTime = blockQuery.data?.timestamp ?? null;
  const endTime = startTime !== null && review ? startTime + review.duration : null;

  if (step === "success" && review) {
    return (
      <section className="space-y-6">
        <div className="flex items-start gap-4 rounded-2xl border border-primary/40 bg-primary/10 p-5">
          <Check aria-hidden="true" className="mt-1 text-primary" size={20} />
          <div className="min-w-0">
            <h2 className="font-semibold">Stream confirmed</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The stream is on-chain. The recipient can withdraw as tokens accrue.
            </p>
            {txHash && (
              <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
                Confirmed transaction: {txHash}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to dashboard
        </button>
      </section>
    );
  }

  if (step !== "form" && review) {
    return (
      <section className="space-y-6">
        <button
          type="button"
          onClick={() => setStep("form")}
          disabled={isSubmitting}
          className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          Edit stream
        </button>
        <div className="rounded-2xl border border-border bg-background p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Agreement review
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">Check before signing</h2>
            </div>
            <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary">
              tUSD8 · 6 decimals
            </span>
          </div>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <ReviewRow label="Recipient" value={review.recipient} mono />
            <ReviewRow
              label="Total deposit"
              value={`${formatTokenAmount(review.amount).display} tUSD8`}
              mono
            />
            <ReviewRow label="Duration" value={formatDuration(review.duration)} />
            <ReviewRow
              label="Rate per second"
              value={formatRatePerSecond(review.amount, review.duration)}
              mono
            />
            <ReviewRow
              label="Rate per hour"
              value={formatRatePerHour(review.amount, review.duration)}
              mono
            />
            <ReviewRow
              label="Estimated start"
              value={startTime !== null ? formatDate(startTime) : "Reading latest block…"}
            />
            <ReviewRow
              label="Estimated end"
              value={endTime !== null ? formatDate(endTime) : "Reading latest block…"}
            />
            <ReviewRow label="Cancellation" value={cancellable ? "Sender may cancel" : "Non-cancellable"} />
            <ReviewRow
              label="Token approval"
              value={enoughAllowance ? "Already approved" : "Required before funding"}
            />
          </dl>
          <p className="mt-5 rounded-xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
            The full amount is funded now. Accrual is calculated on-chain; no tokens move every
            second. The displayed rate is an estimate, and the recipient withdraws earned tokens
            with a separate transaction.
          </p>
        </div>

        <div className="space-y-3" aria-live="polite">
          <TransactionStep
            complete={approvalConfirmed}
            current={step === "approving"}
            label={enoughAllowance ? "Token approval already sufficient" : "Approve tUSD8"}
          />
          <TransactionStep
            complete={step === "success"}
            current={step === "creating"}
            label="Create and fund stream"
          />
        </div>

        {balanceQuery.data && balanceQuery.data.gasBalance === BigInt(0) && (
          <p role="status" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            This wallet has no tQDAY for gas. Get testnet gas from the official QDay faucet before
            signing.
          </p>
        )}
        {balanceQuery.isError && (
          <div className="space-y-2">
            <FormAlert message="Could not read the wallet balance from Aevum RPC. Retry before creating a stream." />
            <button
              type="button"
              onClick={() => void balanceQuery.refetch()}
              className="min-h-10 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Retry balance check
            </button>
          </div>
        )}
        {inputError && (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {inputError}
          </p>
        )}
        {formError && <FormAlert message={formError} />}
        {txHash && step !== "success" && (
          <p className="break-all font-mono text-xs text-muted-foreground" aria-live="polite">
            {txStatus === "pending"
              ? "Submitted transaction"
              : txStatus === "failed"
                ? "Failed transaction"
                : "Confirmed transaction"}
            : {txHash}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="min-h-11 rounded-xl border border-border px-5 text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={createStream}
            disabled={
              !networkReady ||
              !balanceQuery.data ||
              balanceQuery.isError ||
              Boolean(inputError) ||
              isSubmitting
            }
            aria-busy={isSubmitting}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting && (
              <LoaderCircle
                aria-hidden="true"
                size={16}
                className="animate-spin motion-reduce:animate-none"
              />
            )}
            {step === "approving"
              ? "Approval pending…"
              : step === "creating"
                ? "Creation pending…"
                : isSubmitting
                  ? "Checking approval…"
                  : "Confirm and create"}
            {!isSubmitting && (
              <ChevronRight aria-hidden="true" size={16} />
            )}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={reviewStream} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Recipient address" htmlFor="recipient">
          <input
            id="recipient"
            type="text"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            value={recipientInput}
            onChange={(event) => {
              setRecipientInput(event.target.value);
              setFieldErrors((current) => ({ ...current, recipient: undefined }));
              setFormError(null);
            }}
            placeholder="0x…"
            aria-invalid={fieldErrors.recipient ? "true" : undefined}
            aria-describedby={
              fieldErrors.recipient
                ? "recipient-help recipient-error"
                : "recipient-help"
            }
            className="form-input font-mono text-sm"
          />
          {fieldErrors.recipient && (
            <p id="recipient-error" className="text-xs text-destructive">
              {fieldErrors.recipient}
            </p>
          )}
          <p id="recipient-help" className="text-xs leading-5 text-muted-foreground">
            Enter the recipient’s EVM wallet address.
          </p>
        </Field>
        <Field label="Amount · tUSD8" htmlFor="amount">
          <div className="relative">
            <input
              id="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountInput}
              onChange={(event) => {
                setAmountInput(event.target.value);
                setFieldErrors((current) => ({ ...current, amount: undefined }));
                setFormError(null);
              }}
              placeholder="0.00"
              maxLength={80}
              aria-invalid={fieldErrors.amount ? "true" : undefined}
              aria-describedby={
                fieldErrors.amount ? "amount-help amount-error" : "amount-help"
              }
              className="form-input pr-20 font-mono tabular-nums text-sm"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              tUSD8
            </span>
          </div>
          {fieldErrors.amount && (
            <p id="amount-error" className="text-xs text-destructive">
              {fieldErrors.amount}
            </p>
          )}
          <p id="amount-help" className="text-xs leading-5 text-muted-foreground">
            Up to six decimals. One tUSD8 equals 1,000,000 base units.
          </p>
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Stream duration <span className="text-muted-foreground">(required)</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <input
            id="duration"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={durationInput}
            onChange={(event) => {
              setDurationInput(event.target.value);
              setFieldErrors((current) => ({ ...current, duration: undefined }));
              setFormError(null);
            }}
            maxLength={20}
            aria-label="Duration value"
            aria-invalid={fieldErrors.duration ? "true" : undefined}
            aria-describedby={fieldErrors.duration ? "duration-error" : undefined}
            className="form-input font-mono tabular-nums text-sm"
          />
          <select
            id="duration-unit"
            value={durationUnit}
            onChange={(event) => setDurationUnit(parseDurationUnit(event.target.value))}
            aria-label="Duration unit"
            className="form-input text-sm"
          >
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
        {fieldErrors.duration && (
          <p id="duration-error" className="text-xs text-destructive">
            {fieldErrors.duration}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Cancellation terms</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            checked={cancellable}
            title="Cancellable"
            description="Sender can reclaim only the unearned amount."
            onClick={() => setCancellable(true)}
          />
          <ChoiceCard
            checked={!cancellable}
            title="Fixed commitment"
            description="Sender cannot cancel the stream."
            onClick={() => setCancellable(false)}
          />
        </div>
      </fieldset>

      <div className="grid gap-4 rounded-2xl border border-border bg-background p-5 sm:grid-cols-3">
        <Metric label="Estimated rate" value={getRatePreview(amountInput, durationInput, durationUnit)} />
        <Metric
          label="Estimated per hour"
          value={getRatePerHourPreview(amountInput, durationInput, durationUnit)}
        />
        <Metric
          label="tUSD8 balance"
          value={
            balanceQuery.data
              ? `${formatTokenAmount(balanceQuery.data.tokenBalance).display} tUSD8`
              : balanceQuery.isError
                ? "Unavailable"
                : !networkReady
                  ? "Switch network"
                  : "Checking…"
          }
        />
        <Metric
          label="tQDAY for gas"
          value={
            balanceQuery.data
              ? `${formatNativeBalance(balanceQuery.data.gasBalance)} tQDAY`
              : balanceQuery.isError
                ? "Unavailable"
                : !networkReady
                  ? "Switch network"
                  : "Checking…"
          }
        />
      </div>
      {balanceQuery.isError && (
        <div className="space-y-2">
          <FormAlert message="Could not read the wallet balance from Aevum RPC. Retry before creating a stream." />
          <button
            type="button"
            onClick={() => void balanceQuery.refetch()}
            className="min-h-10 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Retry balance check
          </button>
        </div>
      )}
      {!networkReady && (
        <FormAlert message="Switch to QDay Aevum Testnet before creating a stream." />
      )}
      {formError && <FormAlert message={formError} />}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-xl border border-border px-5 text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={
            !networkReady ||
            balanceQuery.isLoading ||
            balanceQuery.isError ||
            balanceQuery.data === undefined
          }
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Review stream
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: Readonly<{ label: string; htmlFor: string; children: React.ReactNode }>) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label} <span className="text-muted-foreground">(required)</span>
      </label>
      {children}
    </div>
  );
}

function ChoiceCard({
  checked,
  title,
  description,
  onClick,
}: Readonly<{
  checked: boolean;
  title: string;
  description: string;
  onClick: () => void;
}>) {
  return (
    <label className="flex min-h-[76px] cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-4 hover:border-primary/60">
      <input
        type="radio"
        name="cancellable"
        checked={checked}
        onChange={onClick}
        className="mt-1 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function ReviewRow({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="min-w-0 border-b border-border/70 pb-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-all text-sm ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-mono text-sm tabular-nums">{value}</p>
    </div>
  );
}

function TransactionStep({
  complete,
  current,
  label,
}: Readonly<{ complete: boolean; current: boolean; label: string }>) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {complete ? (
        <Check aria-hidden="true" size={17} className="text-primary" />
      ) : current ? (
        <LoaderCircle
          aria-hidden="true"
          size={17}
          className="animate-spin text-primary motion-reduce:animate-none"
        />
      ) : (
        <span aria-hidden="true" className="h-[17px] w-[17px] rounded-full border border-border" />
      )}
      <span className={complete || current ? "text-foreground" : "text-muted-foreground"}>
        {label}
        {current && " pending…"}
        {complete && " · confirmed"}
      </span>
    </div>
  );
}

function FormAlert({ message }: Readonly<{ message: string }>) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm leading-6 text-destructive">
      <AlertCircle aria-hidden="true" size={17} className="mt-1 shrink-0" />
      {message}
    </p>
  );
}

function getRatePreview(
  amountValue: string,
  durationValue: string,
  durationUnit: DurationUnit,
): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(amountValue) || !/^\d+$/.test(durationValue)) {
    return "--";
  }
  try {
    const amount = parseTokenAmount(amountValue);
    const duration = BigInt(durationValue) * durationMultipliers[durationUnit];
    if (amount <= BigInt(0) || duration <= BigInt(0)) return "--";
    return formatRatePerSecond(amount, duration);
  } catch {
    return "--";
  }
}

function getRatePerHourPreview(
  amountValue: string,
  durationValue: string,
  durationUnit: DurationUnit,
): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(amountValue) || !/^\d+$/.test(durationValue)) {
    return "--";
  }
  try {
    const amount = parseTokenAmount(amountValue);
    const duration = BigInt(durationValue) * durationMultipliers[durationUnit];
    if (amount <= BigInt(0) || duration <= BigInt(0)) return "--";
    return formatRatePerHour(amount, duration);
  } catch {
    return "--";
  }
}

function formatNativeBalance(balance: bigint): string {
  const [whole = "0", fraction = ""] = formatUnits(balance, 18).split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return `${groupedWhole}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

function parseDurationUnit(value: string): DurationUnit {
  if (value === "seconds" || value === "minutes" || value === "hours" || value === "days") {
    return value;
  }
  throw new Error("Unsupported duration unit.");
}

function transactionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "The wallet transaction could not be completed.";
  if (/user rejected|denied transaction|rejected the request/i.test(message)) {
    return "Transaction rejected in wallet. Your form is unchanged; review it and try again.";
  }
  if (/insufficient funds/i.test(message)) {
    return "Not enough tQDAY for this transaction's gas. Get testnet gas from the official QDay faucet.";
  }
  return message;
}
