"use client";

import { formatTokenAmount } from "@/lib/numbers";

export function TokenAmount({
  value,
  className = "",
  live = false,
}: Readonly<{ value: bigint; className?: string; live?: boolean }>) {
  const formatted = formatTokenAmount(value);
  const characters = formatted.display.split("");

  return (
    <span
      className={`font-mono tabular-nums ${className}`}
      aria-label={formatted.ariaLabel}
      title={formatted.raw}
      aria-live={live ? "polite" : undefined}
    >
      <span aria-hidden="true">
        {characters.map((character, index) =>
          /\d/.test(character) ? (
            <span className="rolling-digit-window" key={index}>
              <span
                className="rolling-digit-track"
                style={{ transform: `translateY(-${Number(character) * 10}%)` }}
              >
                {Array.from({ length: 10 }, (_, digit) => (
                  <span className="rolling-digit-cell" key={digit}>
                    {digit}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span key={index}>{character}</span>
          ),
        )}
      </span>
    </span>
  );
}
