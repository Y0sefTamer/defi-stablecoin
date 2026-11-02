"use client";

import type { TokenMarket } from "@/hooks/use-protocol";
import { formatAmount, formatUsd } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState, Skeleton } from "./ui";

function MarketStatus({ market }: { market: TokenMarket }) {
  if (!market.hasCode) return <Badge tone="danger">No contract</Badge>;
  if (market.stale) return <Badge tone="warn">Stale feed</Badge>;
  return <Badge tone="accent">Live</Badge>;
}

export function MarketTable({
  markets,
  isLoading,
}: {
  markets: TokenMarket[];
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Collateral markets"
        description="What the engine accepts, what it holds, and what you have deposited."
      />

      {isLoading ? (
        <div className="flex flex-col gap-3 px-5 py-5">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <EmptyState title="No collateral tokens configured">
          The engine has no markets on this chain yet.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs tracking-wider text-faint uppercase">
                <th className="px-5 py-2.5 font-medium">Asset</th>
                <th className="px-5 py-2.5 text-right font-medium">Price</th>
                <th className="px-5 py-2.5 text-right font-medium">In protocol</th>
                <th className="px-5 py-2.5 text-right font-medium">Your wallet</th>
                <th className="px-5 py-2.5 text-right font-medium">Your deposit</th>
                <th className="px-5 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {markets.map((market) => (
                <tr key={market.address} className="hover:bg-panel-2/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{market.symbol}</span>
                      <span className="text-xs text-faint">{market.decimals} decimals</span>
                    </div>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    ${formatAmount(market.price, market.priceDecimals, 2)}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {formatAmount(market.engineBalance, market.decimals, 4)}
                    <span className="ml-1 text-xs text-faint">
                      {formatUsd(market.engineBalanceUsd)}
                    </span>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-muted">
                    {formatAmount(market.walletBalance, market.decimals, 4)}
                  </td>
                  <td className="tabular px-5 py-3 text-right">
                    <span className="text-ink">
                      {formatAmount(market.deposited, market.decimals, 6)}
                    </span>
                    <span className="ml-1 text-xs text-faint">
                      {formatUsd(market.depositedUsd)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <MarketStatus market={market} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
