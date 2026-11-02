import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatDuration,
  formatHealthFactor,
  formatPercent,
  formatUsd,
  parseAmount,
  toInputAmount,
  truncateAddress,
} from "./format";

const ONE = 10n ** 18n;

describe("formatAmount", () => {
  it("trims trailing zeros and groups thousands", () => {
    expect(formatAmount(1_234_567n * ONE, 18)).toBe("1,234,567");
    expect(formatAmount(15n * 10n ** 17n, 18)).toBe("1.5");
  });

  it("caps the fraction without rounding", () => {
    expect(formatAmount(1_234_567_890_000_000_000n, 18, 2)).toBe("1.23");
  });

  it("handles token decimals other than 18", () => {
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatAmount(100_000_000n, 8)).toBe("1");
  });

  it("formats zero", () => {
    expect(formatAmount(0n, 18)).toBe("0");
  });
});

describe("formatUsd", () => {
  it("formats small amounts with cents", () => {
    expect(formatUsd(1234n * 10n ** 15n)).toBe("$1.23");
    expect(formatUsd(0n)).toBe("$0");
  });

  it("groups thousands", () => {
    expect(formatUsd(2000n * ONE)).toBe("$2,000");
  });

  it("uses millions and billions", () => {
    expect(formatUsd(1_500_000n * ONE)).toBe("$1.50M");
    expect(formatUsd(2_250_000_000n * ONE)).toBe("$2.25B");
  });

  it("never shows a non-zero amount as $0", () => {
    expect(formatUsd(1n)).toBe("$<0.01");
  });

  it("keeps the sign for negatives", () => {
    expect(formatUsd(-2000n * ONE)).toBe("-$2,000");
  });
});

describe("formatHealthFactor", () => {
  it("prints three decimals", () => {
    expect(formatHealthFactor(2n * ONE)).toBe("2.000");
    expect(formatHealthFactor(1_234n * 10n ** 15n)).toBe("1.234");
  });

  it("prints infinity for no debt", () => {
    expect(formatHealthFactor(null)).toBe("∞");
  });
});

describe("parseAmount", () => {
  it("parses whole and fractional amounts", () => {
    expect(parseAmount("1", 18)).toBe(ONE);
    expect(parseAmount("0.5", 18)).toBe(5n * 10n ** 17n);
    expect(parseAmount(".25", 6)).toBe(250_000n);
    expect(parseAmount("1.", 18)).toBe(ONE);
  });

  it("rejects too many decimals for the token", () => {
    expect(parseAmount("0.0000001", 6)).toBeNull();
  });

  it("rejects empty, malformed and negative input", () => {
    expect(parseAmount("", 18)).toBeNull();
    expect(parseAmount(".", 18)).toBeNull();
    expect(parseAmount("1e18", 18)).toBeNull();
    expect(parseAmount("-1", 18)).toBeNull();
    expect(parseAmount("1,000", 18)).toBeNull();
  });

  it("keeps full precision at 18 decimals", () => {
    expect(parseAmount("0.000000000000000001", 18)).toBe(1n);
  });
});

describe("toInputAmount", () => {
  it("produces a plain decimal string", () => {
    expect(toInputAmount(ONE, 18)).toBe("1");
    expect(toInputAmount(15n * 10n ** 17n, 18)).toBe("1.5");
    expect(toInputAmount(1_500_000n, 6)).toBe("1.5");
  });

  it("returns an empty string for zero so the Max button clears the field", () => {
    expect(toInputAmount(0n, 18)).toBe("");
  });

  it("round-trips through parseAmount", () => {
    expect(parseAmount(toInputAmount(123_456_789n, 6), 6)).toBe(123_456_789n);
  });
});

describe("formatPercent", () => {
  it("formats fractions as percentages", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(0.1234, 2)).toBe("12.34%");
  });

  it("handles non-finite input", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("picks the largest useful unit", () => {
    expect(formatDuration(90_061)).toBe("1d 1h");
    expect(formatDuration(3_661)).toBe("1h 1m");
    expect(formatDuration(61)).toBe("1m");
    expect(formatDuration(5)).toBe("5s");
  });

  it("handles invalid input", () => {
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("truncateAddress", () => {
  it("shortens long values", () => {
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("leaves short values untouched", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });
});
