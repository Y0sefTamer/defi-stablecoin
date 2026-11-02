import { formatUnits } from "viem";

/** Trims trailing zeros and caps the fraction, without losing the leading digits. */
function trimFraction(value: string, maxFractionDigits: number): string {
  if (!value.includes(".")) return value;
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatAmount(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const [whole = "0", fraction = ""] = trimFraction(formatUnits(value, decimals), maxFractionDigits).split(
    ".",
  );
  return fraction ? `${groupThousands(whole)}.${fraction}` : groupThousands(whole);
}

/** Plain decimal string for prefilling an input: no grouping separators. */
export function toInputAmount(value: bigint, decimals: number): string {
  if (value <= 0n) return "";
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  if (!fraction) return whole;
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function formatUsd(value18: bigint, maxFractionDigits = 2): string {
  const sign = value18 < 0n ? "-" : "";
  const absolute = value18 < 0n ? -value18 : value18;
  const numeric = Number(absolute) / 1e18;

  if (numeric >= 1_000_000_000) return `${sign}$${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `${sign}$${(numeric / 1_000_000).toFixed(2)}M`;
  if (numeric >= 10_000) return `${sign}$${Math.round(numeric).toLocaleString("en-US")}`;

  const trimmed = trimFraction(formatUnits(absolute, 18), maxFractionDigits);
  if (trimmed === "0") {
    return absolute === 0n ? "$0" : `${sign}$<0.${"0".repeat(maxFractionDigits - 1)}1`;
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  return `${sign}$${groupThousands(whole)}${fraction ? `.${fraction}` : ""}`;
}

export function formatHealthFactor(value: bigint | null): string {
  if (value === null) return "∞";
  const whole = value / 10n ** 18n;
  const fraction = ((value % 10n ** 18n) / 10n ** 15n).toString().padStart(3, "0");
  return `${whole}.${fraction}`;
}

export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function truncateAddress(address: string, leading = 6, trailing = 4): string {
  if (address.length <= leading + trailing + 2) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

/** Parses user input into a token amount. Returns `null` for anything invalid. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const value = input.trim();
  if (!/^\d*\.?\d*$/.test(value) || value === "" || value === ".") return null;

  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;

  try {
    return BigInt(`${whole || "0"}${fraction.padEnd(decimals, "0")}`);
  } catch {
    return null;
  }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}
