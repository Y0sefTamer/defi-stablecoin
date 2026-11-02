"use client";

import { useSimulateContract } from "wagmi";
import { erc20Abi, type Address } from "viem";

import { TxButton } from "./tx-button";

/**
 * Renders an approve step when the engine cannot pull `required` tokens yet.
 * Approval is exact-amount; the caller re-reads allowance after confirmation.
 */
export function ApprovalGate({
  token,
  spender,
  symbol,
  allowance,
  required,
  disabled,
}: {
  token: Address;
  spender: Address;
  symbol: string;
  allowance: bigint;
  required: bigint;
  disabled?: boolean;
}) {
  const needed = required > allowance;

  const simulation = useSimulateContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, required],
    query: { enabled: needed && !disabled && required > 0n },
  });

  if (!needed) return null;

  return (
    <div className="rounded-lg border border-line bg-base/40 p-3">
      <p className="mb-2 text-xs text-muted">
        Step 1 — approve the engine to move {symbol}. Exact amount, no infinite approval.
      </p>
      <TxButton
        simulation={simulation}
        label={`Approve ${symbol}`}
        pendingLabel="Approving…"
        variant="secondary"
        size="sm"
        disabled={disabled || required === 0n}
        reason="Enter an amount to approve."
      />
    </div>
  );
}
