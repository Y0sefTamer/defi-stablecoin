"use client";

import { useState } from "react";
import { useSimulateContract } from "wagmi";
import type { Address } from "viem";

import { dscEngineAbi } from "@/abis/dsc-engine";
import type { ProtocolSnapshot, TokenMarket } from "@/hooks/use-protocol";
import { formatAmount, formatPercent, formatUsd, parseAmount, toInputAmount } from "@/lib/format";
import { maxAdditionalDsc, maxWithdrawUsd, minBigInt, tokenAmountFromUsd, withMargin } from "@/lib/math";
import { ApprovalGate } from "./approval-gate";
import { TxButton } from "./tx-button";
import { AmountInput, Card, CardHeader, EmptyState, Notice, Segmented } from "./ui";

const COLLATERAL_SLIPPAGE_BPS = 25n;

export function ActionPanel({ snapshot }: { snapshot: ProtocolSnapshot }) {
  const markets = snapshot.usableTokens;
  const [selectedToken, setSelectedToken] = useState<Address | undefined>(undefined);
  const market = markets.find((entry) => entry.address === selectedToken) ?? markets[0];

  if (!market) {
    return (
      <Card>
        <CardHeader title="Manage position" />
        <EmptyState title="No usable collateral market">
          Every configured collateral token is missing bytecode or has a stale price feed on this
          network, so positions cannot be opened.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CollateralCard
        snapshot={snapshot}
        market={market}
        markets={markets}
        onSelectToken={setSelectedToken}
      />
      <DscCard snapshot={snapshot} />
    </div>
  );
}

function CollateralCard({
  snapshot,
  market,
  markets,
  onSelectToken,
}: {
  snapshot: ProtocolSnapshot;
  market: TokenMarket;
  markets: TokenMarket[];
  onSelectToken: (token: Address) => void;
}) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [input, setInput] = useState("");
  const amount = parseAmount(input, market.decimals) ?? 0n;

  const withdrawableUsd = maxWithdrawUsd(
    snapshot.debt,
    snapshot.collateralValue,
    snapshot.riskParams,
  );
  const withdrawableTokens =
    market.price <= 0n
      ? 0n
      : minBigInt(
          market.deposited,
          withMargin(
            tokenAmountFromUsd(withdrawableUsd, market.price, market.decimals, market.priceDecimals),
            COLLATERAL_SLIPPAGE_BPS,
          ),
        );

  const max = mode === "deposit" ? market.walletBalance : withdrawableTokens;

  const blocker = collateralBlocker(mode, amount, market);

  const depositSimulation = useSimulateContract({
    address: snapshot.engine,
    abi: dscEngineAbi,
    functionName: "depositCollateral",
    args: [market.address, amount],
    query: {
      enabled: mode === "deposit" && amount > 0n && blocker === undefined && !snapshot.frozen,
    },
  });

  const withdrawSimulation = useSimulateContract({
    address: snapshot.engine,
    abi: dscEngineAbi,
    functionName: "redeemCollateral",
    args: [market.address, amount],
    query: {
      enabled: mode === "withdraw" && amount > 0n && blocker === undefined && !snapshot.frozen,
    },
  });

  const simulation = mode === "deposit" ? depositSimulation : withdrawSimulation;
  const needsApproval = mode === "deposit" && amount > 0n && market.allowance < amount;
  const submitBlocked = Boolean(blocker) || snapshot.frozen || needsApproval;

  return (
    <Card>
      <CardHeader
        title="Collateral"
        description={`${formatAmount(market.deposited, market.decimals, 4)} ${market.symbol} deposited · ${formatUsd(market.depositedUsd)}`}
        actions={
          <Segmented
            label="Collateral action"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setInput("");
            }}
            options={[
              { value: "deposit", label: "Deposit" },
              { value: "withdraw", label: "Withdraw" },
            ]}
          />
        }
      />

      <div className="flex flex-col gap-4 px-5 py-5">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="collateral-token"
            className="text-xs font-medium tracking-wider text-faint uppercase"
          >
            Asset
          </label>
          <select
            id="collateral-token"
            value={market.address}
            onChange={(event) => onSelectToken(event.target.value as Address)}
            className="rounded-lg border border-line bg-base/60 px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-accent"
          >
            {markets.map((entry) => (
              <option key={entry.address} value={entry.address}>
                {entry.symbol} — ${formatAmount(entry.price, entry.priceDecimals, 2)}
              </option>
            ))}
          </select>
        </div>

        <AmountInput
          id="collateral-amount"
          label={mode === "deposit" ? "Deposit amount" : "Withdraw amount"}
          value={input}
          onChange={setInput}
          symbol={market.symbol}
          max={`${formatAmount(max, market.decimals, 6)} ${market.symbol}`}
          onMax={() => setInput(toInputAmount(max, market.decimals))}
          hint={
            mode === "deposit"
              ? `Wallet ${formatAmount(market.walletBalance, market.decimals, 4)} ${market.symbol} · ${formatUsd(market.walletUsd)}`
              : "Withdrawing lowers your health factor."
          }
        />

        {snapshot.frozen ? (
          <Notice tone="danger" title="Engine frozen">
            A stale price feed blocks every action right now.
          </Notice>
        ) : null}

        {blocker && amount > 0n ? <p className="text-xs text-warn">{blocker}</p> : null}

        {mode === "deposit" ? (
          <ApprovalGate
            token={market.address}
            spender={snapshot.engine}
            symbol={market.symbol}
            allowance={market.allowance}
            required={amount}
            disabled={Boolean(blocker) || snapshot.frozen}
          />
        ) : null}

        <TxButton
          simulation={simulation}
          label={mode === "deposit" ? "Deposit collateral" : "Withdraw collateral"}
          pendingLabel={mode === "deposit" ? "Depositing…" : "Withdrawing…"}
          disabled={submitBlocked}
          reason={
            needsApproval
              ? `Approve ${market.symbol} first.`
              : blocker
                ? blocker
                : snapshot.frozen
                  ? "The engine is frozen by a stale feed."
                  : undefined
          }
          onSuccess={() => setInput("")}
        />

        <p className="text-xs text-faint">
          Collateral is held by the engine at{" "}
          <span className="tabular">{snapshot.engine}</span>. Deposits do not earn yield.
        </p>
      </div>
    </Card>
  );
}

function DscCard({ snapshot }: { snapshot: ProtocolSnapshot }) {
  const [mode, setMode] = useState<"mint" | "repay">("mint");
  const [input, setInput] = useState("");
  const amount = parseAmount(input, 18) ?? 0n;

  const mintCeiling = withMargin(
    maxAdditionalDsc(snapshot.debt, snapshot.collateralValue, snapshot.riskParams),
    COLLATERAL_SLIPPAGE_BPS,
  );
  const repayCeiling = minBigInt(snapshot.dscBalance, snapshot.debt);
  const max = mode === "mint" ? mintCeiling : repayCeiling;

  const blocker = dscBlocker(mode, amount, mintCeiling, snapshot.dscBalance, snapshot.debt);
  const mintSimulation = useSimulateContract({
    address: snapshot.engine,
    abi: dscEngineAbi,
    functionName: "mintDsc",
    args: [amount],
    query: {
      enabled: mode === "mint" && amount > 0n && blocker === undefined && !snapshot.frozen,
    },
  });

  const repaySimulation = useSimulateContract({
    address: snapshot.engine,
    abi: dscEngineAbi,
    functionName: "burnDsc",
    args: [amount],
    query: {
      enabled: mode === "repay" && amount > 0n && blocker === undefined && !snapshot.frozen,
    },
  });

  const simulation = mode === "mint" ? mintSimulation : repaySimulation;
  const needsApproval = mode === "repay" && amount > 0n && snapshot.dscAllowance < amount;
  const submitBlocked = Boolean(blocker) || snapshot.frozen || needsApproval;

  return (
    <Card>
      <CardHeader
        title="DSC"
        description={`${formatAmount(snapshot.debt, 18, 2)} DSC debt · ${formatAmount(snapshot.dscBalance, 18, 2)} DSC in wallet`}
        actions={
          <Segmented
            label="DSC action"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setInput("");
            }}
            options={[
              { value: "mint", label: "Mint" },
              { value: "repay", label: "Repay" },
            ]}
          />
        }
      />

      <div className="flex flex-col gap-4 px-5 py-5">
        <AmountInput
          id="dsc-amount"
          label={mode === "mint" ? "Mint amount" : "Repay amount"}
          value={input}
          onChange={setInput}
          symbol="DSC"
          max={mode === "mint" && max === 0n ? undefined : `${formatAmount(max, 18, 2)} DSC`}
          onMax={() => setInput(toInputAmount(max, 18))}
          hint={
            mode === "mint"
              ? `Borrowing power ${formatUsd(mintCeiling)} before the 1.00 line`
              : `Wallet ${formatAmount(snapshot.dscBalance, 18, 2)} DSC`
          }
        />

        {blocker && amount > 0n ? <p className="text-xs text-warn">{blocker}</p> : null}

        {mode === "repay" ? (
          <ApprovalGate
            token={snapshot.dsc}
            spender={snapshot.engine}
            symbol="DSC"
            allowance={snapshot.dscAllowance}
            required={amount}
            disabled={Boolean(blocker) || snapshot.frozen}
          />
        ) : null}

        <TxButton
          simulation={simulation}
          label={mode === "mint" ? "Mint DSC" : "Repay DSC"}
          pendingLabel={mode === "mint" ? "Minting…" : "Repaying…"}
          disabled={submitBlocked}
          reason={
            needsApproval
              ? "Approve DSC first."
              : blocker
                ? blocker
                : snapshot.frozen
                  ? "The engine is frozen by a stale feed."
                  : undefined
          }
          onSuccess={() => setInput("")}
        />

        <p className="text-xs text-faint">
          DSC is minted 1:1 against USD of collateral value, but only{" "}
          {formatPercent(
            Number(snapshot.riskParams.liquidationThreshold) /
              Number(snapshot.riskParams.liquidationPrecision),
            0,
          )}{" "}
          of that value counts toward your health factor. No interest, no fees, no protocol token.
        </p>
      </div>
    </Card>
  );
}

function collateralBlocker(
  mode: "deposit" | "withdraw",
  amount: bigint,
  market: TokenMarket,
): string | undefined {
  if (amount <= 0n) return "Enter an amount.";
  if (mode === "deposit" && amount > market.walletBalance) {
    return `You only hold ${formatAmount(market.walletBalance, market.decimals, 6)} ${market.symbol}.`;
  }
  if (mode === "withdraw" && amount > market.deposited) {
    return `You have ${formatAmount(market.deposited, market.decimals, 6)} ${market.symbol} deposited.`;
  }
  return undefined;
}

function dscBlocker(
  mode: "mint" | "repay",
  amount: bigint,
  mintCeiling: bigint,
  dscBalance: bigint,
  debt: bigint,
): string | undefined {
  if (amount <= 0n) return "Enter an amount.";
  if (mode === "mint" && amount > mintCeiling) {
    return `You can mint at most ${formatAmount(mintCeiling, 18, 2)} DSC right now.`;
  }
  if (mode === "repay" && amount > dscBalance) {
    return `You only hold ${formatAmount(dscBalance, 18, 2)} DSC.`;
  }
  if (mode === "repay" && amount > debt) {
    return `Your debt is ${formatAmount(debt, 18, 2)} DSC.`;
  }
  return undefined;
}
