import { describe, expect, it } from "vitest";

import {
  DEFAULT_RISK_PARAMS,
  PRECISION,
  healthFactor,
  liquidationPreview,
  maxAdditionalDsc,
  maxLiquidatableDebt,
  maxWithdrawUsd,
  positionHealth,
  priceDropToLiquidation,
  tokenAmountFromUsd,
  usdValue,
  withMargin,
} from "./math";

const WETH_PRICE = 2000n * 10n ** 8n; // Chainlink 8 decimals
const WBTC_PRICE = 60_000n * 10n ** 8n;
const ONE = 10n ** 18n;

describe("usdValue", () => {
  it("prices 18-decimal collateral", () => {
    expect(usdValue(ONE, WETH_PRICE, 18, 8)).toBe(2000n * ONE);
  });

  it("prices 8-decimal collateral", () => {
    expect(usdValue(10n ** 8n, WBTC_PRICE, 8, 8)).toBe(60_000n * ONE);
  });

  it("prices 6-decimal collateral", () => {
    expect(usdValue(1_000_000n, 1n * 10n ** 8n, 6, 8)).toBe(ONE);
  });

  it("returns zero for a zero or negative price", () => {
    expect(usdValue(ONE, 0n, 18, 8)).toBe(0n);
    expect(usdValue(ONE, -1n, 18, 8)).toBe(0n);
  });

  it("floors sub-wei dust instead of rounding up", () => {
    expect(usdValue(1n, 1n, 18, 8)).toBe(0n);
  });
});

describe("tokenAmountFromUsd", () => {
  it("inverts usdValue for 18-decimal collateral", () => {
    expect(tokenAmountFromUsd(2000n * ONE, WETH_PRICE, 18, 8)).toBe(ONE);
  });

  it("inverts usdValue for 6-decimal collateral", () => {
    expect(tokenAmountFromUsd(ONE, 1n * 10n ** 8n, 6, 8)).toBe(1_000_000n);
  });

  it("returns zero for an empty amount or bad price", () => {
    expect(tokenAmountFromUsd(0n, WETH_PRICE, 18, 8)).toBe(0n);
    expect(tokenAmountFromUsd(ONE, 0n, 18, 8)).toBe(0n);
  });
});

describe("health factor math", () => {
  it("uses the 50% liquidation threshold by default", () => {
    expect(DEFAULT_RISK_PARAMS.liquidationThreshold).toBe(50n);
    expect(healthFactor(1000n * ONE, 4000n * ONE)).toBe(2n * PRECISION);
  });

  it("treats no debt as infinite (null)", () => {
    expect(healthFactor(0n, 4000n * ONE)).toBeNull();
  });

  it("reports a position under 1.00 as liquidatable", () => {
    const value = healthFactor(1000n * ONE, 1000n * ONE);
    expect(value).not.toBeNull();
    expect(positionHealth(value)).toBe("liquidatable");
  });

  it("labels the 1.00–1.10 band as danger", () => {
    expect(positionHealth((105n * PRECISION) / 100n)).toBe("danger");
  });

  it("labels the 1.10–1.50 band as warning", () => {
    expect(positionHealth((125n * PRECISION) / 100n)).toBe("warning");
  });

  it("labels anything above 1.50 as safe", () => {
    expect(positionHealth(2n * PRECISION)).toBe("safe");
  });

  it("computes how much more DSC can be minted", () => {
    expect(maxAdditionalDsc(1000n * ONE, 4000n * ONE)).toBe(1000n * ONE);
    expect(maxAdditionalDsc(3000n * ONE, 4000n * ONE)).toBe(0n);
  });

  it("computes how much collateral value can be withdrawn", () => {
    expect(maxWithdrawUsd(1000n * ONE, 4000n * ONE)).toBe(2000n * ONE);
    expect(maxWithdrawUsd(0n, 4000n * ONE)).toBe(4000n * ONE);
    expect(maxWithdrawUsd(9000n * ONE, 1000n * ONE)).toBe(0n);
  });

  it("converts a health factor into a price-drop buffer", () => {
    expect(priceDropToLiquidation(1000n * ONE, 4000n * ONE)).toBeCloseTo(0.5, 10);
    expect(priceDropToLiquidation(0n, 4000n * ONE)).toBeNull();
    expect(priceDropToLiquidation(3000n * ONE, 4000n * ONE)).toBeNull();
  });

  it("never rounds a maximum up past the real limit", () => {
    expect(withMargin(1000n * ONE, 50n)).toBe(995n * ONE);
    expect(withMargin(0n, 50n)).toBe(0n);
  });
});

describe("liquidationPreview", () => {
  const base = {
    debt: 2000n * ONE,
    collateralValue: 3000n * ONE,
    userTokenCollateral: 2n * ONE,
    price: WETH_PRICE,
    tokenDecimals: 18,
    feedDecimals: 8,
  };

  it("adds the 10% bonus to the seized collateral", () => {
    const preview = liquidationPreview({ ...base, debtToCover: 1000n * ONE });
    expect(preview.collateralOut).toBe(55n * 10n ** 16n); // 0.5 WETH + 10%
    expect(preview.collateralValueOut).toBe(1100n * ONE);
    expect(preview.profitUsd).toBe(100n * ONE);
    expect(preview.improvesHealthFactor).toBe(true);
    expect(preview.blocker).toBeUndefined();
  });

  it("rejects a healthy position", () => {
    const preview = liquidationPreview({
      ...base,
      debt: 1000n * ONE,
      collateralValue: 4000n * ONE,
      debtToCover: 100n * ONE,
    });
    expect(preview.blocker).toBe("healthy");
  });

  it("rejects covering more collateral than the account holds", () => {
    const preview = liquidationPreview({
      ...base,
      userTokenCollateral: 10n ** 16n,
      debtToCover: 1000n * ONE,
    });
    expect(preview.blocker).toBe("exceeds-position");
  });

  it("rejects a dust amount that seizes nothing", () => {
    const preview = liquidationPreview({ ...base, debtToCover: 1n });
    expect(preview.blocker).toBe("zero-collateral");
  });

  it("allows a full liquidation even though the remaining health factor is infinite", () => {
    const preview = liquidationPreview({ ...base, debtToCover: 2000n * ONE });
    expect(preview.healthFactorAfter).toBeNull();
    expect(preview.improvesHealthFactor).toBe(true);
    expect(preview.blocker).toBeUndefined();
  });

  it("rejects a partial cover that does not improve the health factor", () => {
    const preview = liquidationPreview({
      // Health factor 0.50: seizing 110% of the debt for 100% of the debt pulls
      // the remaining position even further underwater, so the engine reverts.
      debt: 2000n * ONE,
      collateralValue: 2000n * ONE,
      userTokenCollateral: 2n * ONE,
      price: WETH_PRICE,
      tokenDecimals: 18,
      feedDecimals: 8,
      debtToCover: 1000n * ONE,
    });
    expect(preview.healthFactorAfter).not.toBeNull();
    expect(preview.improvesHealthFactor).toBe(false);
    expect(preview.blocker).toBe("not-improved");
  });
});

describe("maxLiquidatableDebt", () => {
  it("caps the debt at what one token's collateral can cover, bonus included", () => {
    const max = maxLiquidatableDebt({
      debt: 5000n * ONE,
      userTokenCollateral: ONE,
      price: WETH_PRICE,
      tokenDecimals: 18,
      feedDecimals: 8,
    });
    // 1 WETH / 1.1 WETH = 909090909090909090 wei, priced at $2,000
    expect(max).toBe(909090909090909090n * 2000n);
  });

  it("never exceeds the user's debt", () => {
    const max = maxLiquidatableDebt({
      debt: 100n * ONE,
      userTokenCollateral: 10n * ONE,
      price: WETH_PRICE,
      tokenDecimals: 18,
      feedDecimals: 8,
    });
    expect(max).toBe(100n * ONE);
  });
});
