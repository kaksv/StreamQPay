import { formatUnits, parseUnits } from "viem";

export const TOKEN_DECIMALS = 6;
const ZERO = BigInt(0);
const ONE = BigInt(1);

export function parseTokenAmount(value: string): bigint {
  return parseUnits(value.trim(), TOKEN_DECIMALS);
}

export interface FormattedToken {
  display: string;
  raw: string;
  ariaLabel: string;
  isSubscript: boolean;
}

const subscriptDigits: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatTokenAmount(value: bigint): FormattedToken {
  const negative = value < ZERO;
  const absolute = negative ? -value : value;
  const raw = formatUnits(absolute, TOKEN_DECIMALS);
  const [whole = "0", fraction = ""] = raw.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const expanded = `${negative ? "-" : ""}${groupThousands(whole)}${
    trimmedFraction ? `.${trimmedFraction}` : ""
  }`;

  if (absolute === ZERO) {
    return { display: "0", raw: "0", ariaLabel: "0", isSubscript: false };
  }

  const decimalPart = raw.split(".")[1] ?? "";
  const leadingZeros = decimalPart.match(/^0*/)?.[0].length ?? 0;
  if (leadingZeros >= 3) {
    const significant = decimalPart.slice(leadingZeros).replace(/0+$/, "");
    const display = `${negative ? "-" : ""}0.0${String(leadingZeros)
      .split("")
      .map((digit) => subscriptDigits[digit])
      .join("")}${significant}`;
    return {
      display,
      raw: `${negative ? "-" : ""}${raw}`,
      ariaLabel: `${negative ? "-" : ""}${raw}`,
      isSubscript: true,
    };
  }

  return {
    display: expanded,
    raw: `${negative ? "-" : ""}${raw}`,
    ariaLabel: `${negative ? "-" : ""}${expanded}`,
    isSubscript: false,
  };
}

export function formatRatePerSecond(deposit: bigint, duration: bigint): string {
  if (duration <= ZERO) return "--";
  const smallestUnitsPerSecond = deposit / duration;
  if (smallestUnitsPerSecond === ZERO && deposit > ZERO) {
    return "<0.000001 tUSD8 / sec";
  }
  return `${formatTokenAmount(smallestUnitsPerSecond).display} tUSD8 / sec`;
}

export function formatRatePerHour(deposit: bigint, duration: bigint): string {
  if (duration <= ZERO) return "--";
  const smallestUnitsPerHour = (deposit * BigInt(3_600)) / duration;
  if (smallestUnitsPerHour === ZERO && deposit > ZERO) {
    return "<0.000001 tUSD8 / hr";
  }
  return `${formatTokenAmount(smallestUnitsPerHour).display} tUSD8 / hr`;
}

export function formatDate(timestamp: bigint): string {
  if (timestamp <= ZERO || timestamp > BigInt(Number.MAX_SAFE_INTEGER / 1000)) {
    return "--";
  }
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDuration(seconds: bigint): string {
  const units: ReadonlyArray<[bigint, string]> = [
    [BigInt(86_400), "day"],
    [BigInt(3_600), "hour"],
    [BigInt(60), "minute"],
    [ONE, "second"],
  ];
  let remainder = seconds;
  const parts: string[] = [];
  for (const [unitSeconds, label] of units) {
    const count = remainder / unitSeconds;
    if (count > ZERO) {
      parts.push(`${count} ${label}${count === ONE ? "" : "s"}`);
      remainder %= unitSeconds;
    }
  }
  return parts.slice(0, 2).join(" ") || "0 seconds";
}

export function formatPercent(elapsed: bigint, duration: bigint): string {
  if (duration <= ZERO) return "--";
  const hundred = BigInt(100);
  const tenThousand = BigInt(10_000);
  const basisPoints = (elapsed * tenThousand) / duration;
  const bounded = basisPoints > tenThousand ? tenThousand : basisPoints;
  const whole = bounded / hundred;
  const fraction = String(bounded % hundred).padStart(2, "0");
  return `${whole}.${fraction}%`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function estimateAccrued(
  deposit: bigint,
  startTime: bigint,
  endTime: bigint,
  cancelledAt: bigint,
  cancelled: boolean,
  chainTimestamp: bigint,
  fetchedAtMs: number,
  nowMs: number,
): bigint {
  const localElapsedSeconds = BigInt(
    Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000)),
  );
  const estimatedChainTime = chainTimestamp + localElapsedSeconds;
  const stopTime = cancelled
    ? cancelledAt
    : estimatedChainTime < endTime
      ? estimatedChainTime
      : endTime;
  if (stopTime <= startTime) return ZERO;
  if (stopTime >= endTime) return deposit;
  return (deposit * (stopTime - startTime)) / (endTime - startTime);
}
