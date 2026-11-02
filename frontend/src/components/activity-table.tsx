"use client";

import type { ActivityItem, ActivityKind } from "@/lib/activity";
import { explorerTxUrl } from "@/config/chains";
import { formatAmount, truncateAddress } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState, Skeleton } from "./ui";

export type TokenMeta = { symbol: string; decimals: number };

const KIND_META: Record<
  ActivityKind,
  { label: string; tone: "neutral" | "accent" | "warn" | "danger" | "info"; sign: string }
> = {
  deposit: { label: "Deposited collateral", tone: "info", sign: "+" },
  withdraw: { label: "Withdrew collateral", tone: "neutral", sign: "−" },
  borrow: { label: "Minted DSC", tone: "accent", sign: "+" },
  repay: { label: "Repaid DSC", tone: "neutral", sign: "−" },
  "liquidation-seized": { label: "Seized by liquidator", tone: "danger", sign: "−" },
  "liquidation-received": { label: "Seized as liquidator", tone: "accent", sign: "+" },
  "transfer-in": { label: "DSC received", tone: "info", sign: "+" },
  "transfer-out": { label: "DSC sent", tone: "neutral", sign: "−" },
};

export function ActivityTable({
  items,
  isLoading,
  chainId,
  tokens,
  dsc,
}: {
  items: ActivityItem[];
  isLoading: boolean;
  chainId: number;
  tokens: Record<string, TokenMeta>;
  dsc: TokenMeta;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Activity" />
        <div className="flex flex-col gap-2 px-5 py-4">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader title="Activity" />
        <EmptyState title="No activity yet">
          Deposits, mints, repayments and liquidations show up here, reconstructed from the
          engine&apos;s events.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Activity"
        description={`${items.length} events, newest first. Mint, repay and liquidation rows are inferred from DSC transfers and redeem events.`}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wider text-faint uppercase">
              <th className="px-5 py-2.5 font-medium">Event</th>
              <th className="px-5 py-2.5 text-right font-medium">Amount</th>
              <th className="px-5 py-2.5 text-right font-medium">Counterparty</th>
              <th className="px-5 py-2.5 text-right font-medium">Block</th>
              <th className="px-5 py-2.5 text-right font-medium">Transaction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((item) => {
              const meta = KIND_META[item.kind];
              const token = item.token ? tokens[item.token.toLowerCase()] : dsc;
              const decimals = token?.decimals ?? 18;
              const symbol = token?.symbol ?? "DSC";
              const explorer = explorerTxUrl(chainId, item.transactionHash);
              const txId = item.id.split("-")[0] ?? item.transactionHash;

              return (
                <tr key={item.id} className="hover:bg-panel-2/40">
                  <td className="px-5 py-3">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {meta.sign}
                    {formatAmount(item.amount, decimals, 6)} {symbol}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-muted">
                    {item.counterparty ? truncateAddress(item.counterparty) : "—"}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-muted">
                    {item.blockNumber.toString()}
                  </td>
                  <td className="tabular px-5 py-3 text-right">
                    {explorer ? (
                      <a
                        href={explorer}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-accent hover:underline"
                      >
                        {truncateAddress(txId, 8, 6)}
                      </a>
                    ) : (
                      <span className="text-muted">{truncateAddress(txId, 8, 6)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
