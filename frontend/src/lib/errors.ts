import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

import { formatHealthFactor } from "./format";

export type TxError = {
  title: string;
  detail?: string;
  /** True for "user clicked reject in the wallet": not an error state. */
  isRejection: boolean;
  /** Solidity error name when it could be decoded. */
  name?: string;
};

const MESSAGES: Record<string, string> = {
  DSCEngine__NeedsMoreThanZero: "Amount must be greater than zero.",
  DSCEngine__TokenNotAllowed: "That token is not accepted as collateral.",
  DSCEngine__TransferFailed: "Token transfer failed. Check your balance and allowance.",
  DSCEngine__MintFailed: "DSC could not be minted.",
  DSCEngine__HealthFactorOk: "This position is healthy, so there is nothing to liquidate.",
  DSCEngine__HealthFactorNotImproved:
    "Liquidating this amount would not improve the position. Cover more of the debt.",
  DSCEngine__TokenAddressesAndPriceFeedAddressesAmountsDontMatch:
    "Deployment misconfigured: token and price feed lists differ in length.",
  OracleLib__StalePrice:
    "The price feed is older than 3 hours, so the engine is frozen by design.",
  DecentralizedStableCoin__AmountMustBeMoreThanZero: "Amount must be greater than zero.",
  DecentralizedStableCoin__BurnAmountExceedsBalance: "You do not hold that much DSC.",
  DecentralizedStableCoin__NotZeroAddress: "Invalid recipient address.",
  ERC20InsufficientAllowance: "Approve the token before sending this transaction.",
  ERC20InsufficientBalance: "Not enough token balance.",
  InsufficientAllowance: "Approve the token before sending this transaction.",
};

export function describeError(error: unknown): TxError {
  if (error instanceof BaseError) {
    const rejection = error.walk((cause) => cause instanceof UserRejectedRequestError);
    if (rejection) {
      return { title: "Transaction cancelled", isRejection: true };
    }

    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const errorName = revert.data?.errorName;
      const args = revert.data?.args ?? [];

      if (errorName === "DSCEngine__BreaksHealthFactor") {
        const healthFactor = typeof args[0] === "bigint" ? formatHealthFactor(args[0]) : "below 1.00";
        return {
          title: "Health factor too low",
          detail: `This would leave the position at ${healthFactor}, below the 1.00 minimum.`,
          isRejection: false,
          name: errorName,
        };
      }

      if (errorName && MESSAGES[errorName]) {
        return { title: MESSAGES[errorName], isRejection: false, name: errorName };
      }

      if (errorName === "Panic" || revert.reason?.includes("arithmetic")) {
        return {
          title: "Amount exceeds what the engine holds for you",
          detail: "You cannot withdraw or burn more than you deposited or borrowed.",
          isRejection: false,
          name: errorName ?? "Panic",
        };
      }

      return {
        title: "Transaction reverted",
        detail: revert.shortMessage,
        isRejection: false,
        name: errorName,
      };
    }

    return {
      title: error.shortMessage || "Transaction failed",
      detail: error.details,
      isRejection: false,
    };
  }

  if (error instanceof Error) {
    return { title: error.message, isRejection: false };
  }

  return { title: "Unexpected error", isRejection: false };
}
