"use client";

import type { TokenMarket } from "@/hooks/use-protocol";
import { formatDuration, truncateAddress } from "@/lib/format";
import { Badge, Notice } from "./ui";

/**
 * Surfaces the two ways this app can be read-only: a collateral address with no
 * code on the selected chain, and a price feed older than the oracle timeout.
 */
export function OracleBanner({
  markets,
  frozen,
  now,
}: {
  markets: TokenMarket[];
  frozen: boolean;
  now: number;
}) {
  const missing = markets.filter((market) => !market.hasCode);
  const stale = markets.filter((market) => market.hasCode && market.stale);

  if (missing.length === 0 && stale.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {frozen ? (
        <Notice tone="danger" title="Engine writes are frozen">
          At least one price feed is stale. <code>OracleLib</code> reverts every priced action
          until the feed is fresh again, so deposits, mints and liquidations will fail.
        </Notice>
      ) : null}

      {missing.map((market) => (
        <Notice key={market.address} tone="warn" title={`${market.symbol} market unavailable`}>
          No contract bytecode at{" "}
          <span className="tabular text-ink">{truncateAddress(market.address)}</span> on this network.
          It is still in the engine&apos;s token list, so it is shown but cannot be used.
        </Notice>
      ))}

      {stale.map((market) => {
        const age = market.updatedAt === 0n ? null : now - Number(market.updatedAt);
        return (
          <Notice key={market.address} tone="warn" title={`${market.symbol} price feed is stale`}>
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">paused</Badge>
              {age === null ? "No round data returned." : `Last update ${formatDuration(age)} ago.`}
            </span>
          </Notice>
        );
      })}
    </div>
  );
}
