/**
 * Mirrors the on-chain accounting of DSCEngine in BigInt.
 *
 * Every function here is pure so it can be unit-tested against the Solidity
 * behaviour without a chain. When the contract changes, these are the first
 * functions to re-check: the UI pre-checks revert conditions with them.
 */

export const PRECISION = 10n ** 18n;
export const BPS = 10_000n;
export const MAX_UINT256 = 2n ** 256n - 1n;
export const ORACLE_TIMEOUT_SECONDS = 3n * 60n * 60n;

export type RiskParams = {
  liquidationThreshold: bigint;
  liquidationPrecision: bigint;
  liquidationBonus: bigint;
  minHealthFactor: bigint;
};

export const DEFAULT_RISK_PARAMS: RiskParams = {
  liquidationThreshold: 50n,
  liquidationPrecision: 100n,
  liquidationBonus: 10n,
  minHealthFactor: PRECISION,
};

export function pow10(exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0) throw new RangeError(`pow10: bad exponent ${exp}`);
  return 10n ** BigInt(exp);
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** USD value with 18 decimals, floored exactly like `DSCEngine.getUsdValue`. */
export function usdValue(
  amount: bigint,
  price: bigint,
  tokenDecimals: number,
  feedDecimals: number,
): bigint {
  if (price <= 0n || amount <= 0n) return 0n;
  // usd18 = amount/10^td * price/10^fd * 1e18 = amount * price * 10^(18 - td - fd)
  const exponent = 18 - tokenDecimals - feedDecimals;
  if (exponent >= 0) return amount * price * pow10(exponent);
  return (amount * price) / pow10(-exponent);
}

/** Token amount for a USD value with 18 decimals, floored like `getTokenAmountFromUsd`. */
export function tokenAmountFromUsd(
  usd: bigint,
  price: bigint,
  tokenDecimals: number,
  feedDecimals: number,
): bigint {
  if (price <= 0n || usd <= 0n) return 0n;
  return (usd * pow10(tokenDecimals + feedDecimals)) / (price * PRECISION);
}

export function adjustedCollateralValue(
  collateralValue: bigint,
  { liquidationThreshold, liquidationPrecision }: RiskParams = DEFAULT_RISK_PARAMS,
): bigint {
  return (collateralValue * liquidationThreshold) / liquidationPrecision;
}

/** `null` means "no debt", i.e. the on-chain `type(uint256).max` sentinel. */
export function healthFactor(
  debt: bigint,
  collateralValue: bigint,
  params: RiskParams = DEFAULT_RISK_PARAMS,
): bigint | null {
  if (debt <= 0n) return null;
  return (adjustedCollateralValue(collateralValue, params) * PRECISION) / debt;
}

/** DSC that can still be minted before the health factor hits the minimum. */
export function maxAdditionalDsc(
  debt: bigint,
  collateralValue: bigint,
  params: RiskParams = DEFAULT_RISK_PARAMS,
): bigint {
  const adjusted = adjustedCollateralValue(collateralValue, params);
  return adjusted > debt ? adjusted - debt : 0n;
}

/** Collateral (in 18-decimal USD) that can be withdrawn before the health factor hits 1.0. */
export function maxWithdrawUsd(
  debt: bigint,
  collateralValue: bigint,
  params: RiskParams = DEFAULT_RISK_PARAMS,
): bigint {
  if (debt <= 0n) return collateralValue;
  const required = (debt * params.liquidationPrecision) / params.liquidationThreshold;
  return collateralValue > required ? collateralValue - required : 0n;
}

/**
 * Fractional drop in collateral value that takes the position to health factor 1.0.
 * `0.25` means "a 25% drop". `null` when there is no debt or the position is already
 * below 1.0.
 */
export function priceDropToLiquidation(
  debt: bigint,
  collateralValue: bigint,
  params: RiskParams = DEFAULT_RISK_PARAMS,
): number | null {
  if (debt <= 0n || collateralValue <= 0n) return null;
  const required = (debt * params.liquidationPrecision) / params.liquidationThreshold;
  if (required >= collateralValue) return null;
  return 1 - Number(required) / Number(collateralValue);
}

/** Applies a safety margin (in bps) to a maximum, so rounding never trips the contract. */
export function withMargin(amount: bigint, marginBps: bigint = 50n): bigint {
  if (amount <= 0n) return 0n;
  return (amount * (BPS - marginBps)) / BPS;
}

export type LiquidationPreview = {
  /** Health factor before the liquidation, `null` = no debt. */
  healthFactorBefore: bigint | null;
  /** Health factor after covering the requested debt. */
  healthFactorAfter: bigint | null;
  /** Collateral seized for the covered debt, including the bonus. */
  collateralOut: bigint;
  /** Value of the seized collateral in USD (18 decimals). */
  collateralValueOut: bigint;
  /** Profit for the liquidator, in USD (18 decimals): the bonus only. */
  profitUsd: bigint;
  /** Exactly mirrors the contract's strict-improvement requirement. */
  improvesHealthFactor: boolean;
  /** Why the contract would revert, if it would. */
  blocker?: "no-debt" | "healthy" | "exceeds-position" | "not-improved" | "zero-collateral";
};

/**
 * Largest debt a liquidator can cover against one collateral token without
 * asking for more collateral than the user has deposited.
 */
export function maxLiquidatableDebt(input: {
  debt: bigint;
  userTokenCollateral: bigint;
  price: bigint;
  tokenDecimals: number;
  feedDecimals: number;
  params?: RiskParams;
}): bigint {
  const params = input.params ?? DEFAULT_RISK_PARAMS;
  const maxTokenAmount =
    (input.userTokenCollateral * params.liquidationPrecision) /
    (params.liquidationPrecision + params.liquidationBonus);
  const value = usdValue(
    maxTokenAmount,
    input.price,
    input.tokenDecimals,
    input.feedDecimals,
  );
  return value < input.debt ? value : input.debt;
}

export function liquidationPreview(input: {
  debt: bigint;
  collateralValue: bigint;
  userTokenCollateral: bigint;
  debtToCover: bigint;
  price: bigint;
  tokenDecimals: number;
  feedDecimals: number;
  params?: RiskParams;
}): LiquidationPreview {
  const params = input.params ?? DEFAULT_RISK_PARAMS;
  const before = healthFactor(input.debt, input.collateralValue, params);

  const tokenAmount = tokenAmountFromUsd(
    input.debtToCover,
    input.price,
    input.tokenDecimals,
    input.feedDecimals,
  );
  const bonus = (tokenAmount * params.liquidationBonus) / params.liquidationPrecision;
  const collateralOut = tokenAmount + bonus;
  const collateralValueOut = usdValue(
    collateralOut,
    input.price,
    input.tokenDecimals,
    input.feedDecimals,
  );

  const remainingDebt = input.debt > input.debtToCover ? input.debt - input.debtToCover : 0n;
  const remainingValue =
    input.collateralValue > collateralValueOut
      ? input.collateralValue - collateralValueOut
      : 0n;
  const after = healthFactor(remainingDebt, remainingValue, params);

  const improvesHealthFactor =
    before !== null &&
    collateralOut > 0n &&
    (after === null || after > before);

  let blocker: LiquidationPreview["blocker"];
  if (input.debt === 0n) blocker = "no-debt";
  else if (before !== null && before >= params.minHealthFactor) blocker = "healthy";
  else if (collateralOut === 0n) blocker = "zero-collateral";
  else if (collateralOut > input.userTokenCollateral) blocker = "exceeds-position";
  else if (!improvesHealthFactor) blocker = "not-improved";

  return {
    healthFactorBefore: before,
    healthFactorAfter: after,
    collateralOut,
    collateralValueOut,
    profitUsd: collateralValueOut > input.debtToCover ? collateralValueOut - input.debtToCover : 0n,
    improvesHealthFactor,
    blocker,
  };
}

/**
 * Health-factor based position state. Kept separate from the contract's raw
 * value so the UI can label zones consistently.
 */
export type PositionHealth = "no-debt" | "liquidatable" | "danger" | "warning" | "safe";

export function positionHealth(
  healthFactorValue: bigint | null,
  params: RiskParams = DEFAULT_RISK_PARAMS,
): PositionHealth {
  if (healthFactorValue === null) return "no-debt";
  if (healthFactorValue < params.minHealthFactor) return "liquidatable";
  if (healthFactorValue < (params.minHealthFactor * 11n) / 10n) return "danger";
  if (healthFactorValue < (params.minHealthFactor * 15n) / 10n) return "warning";
  return "safe";
}
