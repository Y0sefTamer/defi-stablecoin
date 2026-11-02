"use client";

import Link from "next/link";
import { useConnection } from "wagmi";

import { MarketTable } from "@/components/market-table";
import { OracleBanner } from "@/components/oracle-banner";
import { ProtocolStats, RiskParameters, StatisticsSkeleton } from "@/components/protocol-stats";
import { Badge, Button, Card, CardHeader, Notice } from "@/components/ui";
import { getDeployment } from "@/config/contracts";
import { useChainSelection } from "@/hooks/use-chain-selection";
import { useProtocolSnapshot } from "@/hooks/use-protocol";

export default function DashboardPage() {
  const { chainId } = useChainSelection();
  const { address } = useConnection();
  const deployment = getDeployment(chainId);
  const snapshot = useProtocolSnapshot(chainId, address);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Overcollateralized</Badge>
          <Badge tone="neutral">Exogenous collateral</Badge>
          <Badge tone="neutral">No governance token</Badge>
        </div>
        <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-ink sm:text-4xl">
          A stablecoin backed by WETH and WBTC, priced by Chainlink, liquidated by anyone.
        </h1>
        <p className="max-w-2xl text-sm text-muted sm:text-base">
          Deposit collateral worth at least twice your debt, mint DSC at a dollar each, and keep
          your health factor above 1.00. No interest, no admin keys over user funds, no oracle
          fallback that quietly lies.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/position">
            <Button size="sm">Open a position</Button>
          </Link>
          <Link href="/liquidate">
            <Button size="sm" variant="secondary">
              Find liquidations
            </Button>
          </Link>
        </div>
      </section>

      {!deployment ? (
        <Notice tone="warn" title="No deployment for this network">
          The app has no engine address for chain {chainId}. Deploy with{" "}
          <code>make deploy</code> and run <code>pnpm sync:deployments</code>, or set{" "}
          <code>NEXT_PUBLIC_DSC_ENGINE_{chainId}</code>.
        </Notice>
      ) : snapshot.error ? (
        <Notice tone="danger" title="Could not read the protocol">
          <div className="flex flex-col gap-2">
            <span>{snapshot.error instanceof Error ? snapshot.error.message : "Unknown error"}</span>
            <Button size="sm" variant="secondary" onClick={() => void snapshot.refetch()}>
              Retry
            </Button>
          </div>
        </Notice>
      ) : null}

      {snapshot.data ? (
        <>
          <OracleBanner
            markets={snapshot.data.tokens}
            frozen={snapshot.data.frozen}
            now={snapshot.data.now}
          />
          <ProtocolStats snapshot={snapshot.data} />
        </>
      ) : (
        <StatisticsSkeleton />
      )}

      <MarketTable markets={snapshot.data?.tokens ?? []} isLoading={snapshot.isLoading} />

      {snapshot.data ? <RiskParameters snapshot={snapshot.data} /> : null}

      <Card>
        <CardHeader title="How the peg stays honest" />
        <ol className="grid gap-px bg-line sm:grid-cols-3">
          {[
            {
              title: "1 · Deposit",
              body: "Collateral is held by the engine. Every token has its own Chainlink feed with a 3 hour staleness check.",
            },
            {
              title: "2 · Mint",
              body: "DSC is minted against 50% of your collateral value. At $2,000 of WETH you can mint at most 1,000 DSC.",
            },
            {
              title: "3 · Liquidate",
              body: "Below 1.00 anyone can repay the debt and take the collateral plus a 10% bonus, which pulls the peg back.",
            },
          ].map((step) => (
            <li key={step.title} className="bg-panel px-5 py-5">
              <p className="text-xs font-semibold tracking-wider text-accent uppercase">
                {step.title}
              </p>
              <p className="mt-2 text-sm text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
