"use client";

import { useState } from "react";
import { useSimulateContract } from "wagmi";
import type { Address } from "viem";

import { dscEngineAbi } from "@/abis/dsc-engine";
import type { BorrowerRow } from "@/hooks/use-borrowers";
import type { ProtocolSnapshot } from "@/hooks/use-protocol";
import {
  formatAmount,
  formatHealthFactor,
  formatUsd,
  parseAmount,
  toInputAmount,
  truncateAddress,
} from "@/lib/format";
import {
  liquidationPreview,
  maxLiquidatableDebt,
  withMargin,
  type LiquidationPreview,
} from "@/lib/math";
import { ApprovalGate } from "./approval-gate";
import { HealthFactorBadge } from "./health-factor";
import { TxButton } from "./tx-button";
import { AmountInput, Badge, Button, Card, CardHeader, EmptyState, Notice, Skeleton, Stat } from "./ui";

const LIQUIDATION_MARGIN_BPS = 10n;

const BLOCKER_COPY: Record<NonNullable<LiquidationPreview["blocker"]>, string> = {
  "no-debt": "This account has no DSC debt.",
  healthy: "This position is above the 1.00 liquidation line.",
  "exceeds-position": "That debt would seize more collateral than the account holds in this token.",
  "not-improved": "Covering this amount would not improve the health factor. Cover more of the debt.",
  "zero-collateral": "The requested debt rounds to zero collateral.",
};

export function LiquidatePanel({
  snapshot,
  borrowers,
  isLoading,
  account,
}: {
  snapshot: ProtocolSnapshot;
  borrowers: BorrowerRow[];
  isLoading: boolean;
  account?: Address;
}) {
  const [selected, setSelected] = useState<Address | undefined>(undefined);
  const [tokenAddress, setTokenAddress] = useState<Address | undefined>(undefined);
  const [input, setInput] = useState("");

  const borrower = borrowers.find((row) => row.address === selected) ?? borrowers[0];

  const positions = borrower
    ? borrower.collateral.flatMap((amount, index) => {
        const market = snapshot.tokens[index];
        return market && amount > 0n ? [{ market, amount }] : [];
      })
    : [];

  const position =
    positions.find((entry) => entry.market.address === tokenAddress) ?? positions[0];
  const amount = parseAmount(input, 18) ?? 0n;

  const maxDebt = position
    ? withMargin(
        maxLiquidatableDebt({
          debt: borrower?.debt ?? 0n,
          userTokenCollateral: position.amount,
          price: position.market.price,
          tokenDecimals: position.market.decimals,
          feedDecimals: position.market.priceDecimals,
          params: snapshot.riskParams,
        }),
        LIQUIDATION_MARGIN_BPS,
      )
    : 0n;

  const preview =
    borrower && position && amount > 0n
      ? liquidationPreview({
          debt: borrower.debt,
          collateralValue: borrower.collateralValue,
          userTokenCollateral: position.amount,
          debtToCover: amount,
          price: position.market.price,
          tokenDecimals: position.market.decimals,
          feedDecimals: position.market.priceDecimals,
          params: snapshot.riskParams,
        })
      : undefined;

  const blocker = liquidationBlocker({
    account,
    borrower,
    hasPosition: Boolean(position),
    amount,
    preview,
    dscBalance: snapshot.dscBalance,
    frozen: snapshot.frozen,
  });

  const simulation = useSimulateContract({
    address: snapshot.engine,
    abi: dscEngineAbi,
    functionName: "liquidate",
    args:
      borrower && position
        ? [position.market.address, borrower.address, amount]
        : undefined,
    query: {
      enabled: Boolean(borrower && position) && amount > 0n && blocker === undefined,
    },
  });

  const needsApproval = amount > 0n && snapshot.dscAllowance < amount;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Liquidatable accounts"
          description="Discovered from deposit events since the deployment block. Only accounts with debt are listed."
          actions={<Badge tone="neutral">{borrowers.length} with debt</Badge>}
        />

        {isLoading ? (
          <div className="flex flex-col gap-2 px-5 py-4">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : borrowers.length === 0 ? (
          <EmptyState title="No debt in the protocol">
            Nobody has minted DSC on this deployment yet. Deposits alone are not liquidatable.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs tracking-wider text-faint uppercase">
                  <th className="px-5 py-2.5 font-medium">Account</th>
                  <th className="px-5 py-2.5 text-right font-medium">Debt</th>
                  <th className="px-5 py-2.5 text-right font-medium">Collateral</th>
                  <th className="px-5 py-2.5 text-right font-medium">Health</th>
                  <th className="px-5 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {borrowers.map((row) => {
                  const liquidatable = row.healthFactor < snapshot.riskParams.minHealthFactor;
                  return (
                    <tr
                      key={row.address}
                      className={
                        row.address === borrower?.address ? "bg-panel-2/60" : "hover:bg-panel-2/40"
                      }
                    >
                      <td className="tabular px-5 py-3 text-ink">
                        {truncateAddress(row.address)}
                        {row.address === account ? (
                          <span className="ml-2 text-[11px] text-faint">you</span>
                        ) : null}
                      </td>
                      <td className="tabular px-5 py-3 text-right text-ink">
                        {formatAmount(row.debt, 18, 2)}
                      </td>
                      <td className="tabular px-5 py-3 text-right text-muted">
                        {formatUsd(row.collateralValue)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className={
                              liquidatable ? "tabular text-danger" : "tabular text-muted"
                            }
                          >
                            {formatHealthFactor(row.healthFactor)}
                          </span>
                          {liquidatable ? <Badge tone="danger">liquidatable</Badge> : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setSelected(row.address);
                            setTokenAddress(undefined);
                            setInput("");
                          }}
                        >
                          {row.address === borrower?.address ? "Selected" : "Select"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Liquidate"
          description="Repay part of an unhealthy account's DSC and receive its collateral plus the bonus."
        />

        {!borrower ? (
          <EmptyState title="Pick an account first">
            Select a row above to see what a liquidation would return.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5 px-5 py-5">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat label="Account" value={truncateAddress(borrower.address)} />
              <Stat label="Debt" value={`${formatAmount(borrower.debt, 18, 2)} DSC`} />
              <Stat label="Collateral" value={formatUsd(borrower.collateralValue)} />
              <Stat
                label="Health"
                value={formatHealthFactor(borrower.healthFactor)}
                tone={
                  borrower.healthFactor < snapshot.riskParams.minHealthFactor
                    ? "danger"
                    : "default"
                }
              />
            </div>

            {positions.length === 0 ? (
              <Notice tone="warn" title="No usable collateral">
                This account&apos;s collateral is in tokens that are missing or stale on this
                network, so it cannot be seized here.
              </Notice>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="liquidate-token"
                    className="text-xs font-medium tracking-wider text-faint uppercase"
                  >
                    Collateral to seize
                  </label>
                  <select
                    id="liquidate-token"
                    value={position?.market.address}
                    onChange={(event) => {
                      setTokenAddress(event.target.value as Address);
                      setInput("");
                    }}
                    className="rounded-lg border border-line bg-base/60 px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-accent"
                  >
                    {positions.map((entry) => (
                      <option key={entry.market.address} value={entry.market.address}>
                        {entry.market.symbol} — {formatAmount(entry.amount, entry.market.decimals, 4)}{" "}
                        deposited
                      </option>
                    ))}
                  </select>
                </div>

                <AmountInput
                  id="liquidate-amount"
                  label="DSC to repay"
                  value={input}
                  onChange={setInput}
                  symbol="DSC"
                  max={`${formatAmount(maxDebt, 18, 2)} DSC`}
                  onMax={() => setInput(toInputAmount(maxDebt, 18))}
                  hint={`Wallet ${formatAmount(snapshot.dscBalance, 18, 2)} DSC · debt ${formatAmount(borrower.debt, 18, 2)} DSC`}
                />

                {preview ? (
                  <div className="grid grid-cols-2 gap-6 rounded-lg border border-line bg-base/40 px-4 py-4 sm:grid-cols-4">
                    <Stat
                      label="Collateral out"
                      value={
                        position
                          ? `${formatAmount(preview.collateralOut, position.market.decimals, 6)} ${position.market.symbol}`
                          : "—"
                      }
                    />
                    <Stat
                      label="Value seized"
                      value={formatUsd(preview.collateralValueOut)}
                      hint="Includes the bonus"
                    />
                    <Stat
                      label="Profit"
                      value={formatUsd(preview.profitUsd)}
                      tone={preview.profitUsd > 0n ? "accent" : "default"}
                    />
                    <Stat
                      label="Health after"
                      value={formatHealthFactor(preview.healthFactorAfter)}
                      hint="Must be strictly higher"
                      tone={preview.improvesHealthFactor ? "default" : "warn"}
                    />
                  </div>
                ) : null}

                {blocker && amount > 0n ? <p className="text-xs text-warn">{blocker}</p> : null}

                <ApprovalGate
                  token={snapshot.dsc}
                  spender={snapshot.engine}
                  symbol="DSC"
                  allowance={snapshot.dscAllowance}
                  required={amount}
                  disabled={Boolean(blocker)}
                />

                <TxButton
                  simulation={simulation}
                  label="Liquidate"
                  pendingLabel="Liquidating…"
                  variant="danger"
                  disabled={Boolean(blocker) || needsApproval}
                  reason={
                    needsApproval ? "Approve DSC first." : blocker
                  }
                  onSuccess={() => {
                    setInput("");
                    setSelected(undefined);
                  }}
                />

                <p className="text-xs text-faint">
                  Your own position must stay above 1.00 after the liquidation. A liquidation is
                  atomic: it either seizes collateral, burns the debt and leaves you healthier, or
                  it reverts.
                </p>
              </>
            )}
          </div>
        )}
      </Card>

      <HealthFactorLegend />
    </div>
  );
}

function HealthFactorLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <HealthFactorBadge value={null} />
      <span>no debt, nothing to liquidate</span>
      <span aria-hidden="true">·</span>
      <Badge tone="danger">below 1.00</Badge>
      <span>seizable by anyone</span>
    </div>
  );
}

function liquidationBlocker(input: {
  account?: Address;
  borrower?: BorrowerRow;
  hasPosition: boolean;
  amount: bigint;
  preview?: LiquidationPreview;
  dscBalance: bigint;
  frozen: boolean;
}): string | undefined {
  if (!input.account) return "Connect a wallet to liquidate.";
  if (!input.borrower) return "Select a position to liquidate.";
  if (!input.hasPosition) return "This account has no collateral in a usable market.";
  if (input.amount <= 0n) return "Enter an amount.";
  if (input.amount > input.borrower.debt) {
    return `The account owes ${formatAmount(input.borrower.debt, 18, 2)} DSC.`;
  }
  if (input.dscBalance < input.amount) {
    return `You only hold ${formatAmount(input.dscBalance, 18, 2)} DSC.`;
  }
  if (input.preview?.blocker) return BLOCKER_COPY[input.preview.blocker];
  if (input.frozen) return "The engine is frozen by a stale price feed.";
  return undefined;
}
