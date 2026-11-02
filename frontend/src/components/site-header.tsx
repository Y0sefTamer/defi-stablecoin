"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "./ui";
import { ChainSwitcher } from "./chain-switcher";
import { WalletButton } from "./wallet-button";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/position", label: "Position" },
  { href: "/liquidate", label: "Liquidate" },
  { href: "/activity", label: "Activity" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md border border-accent/40 bg-accent-dim text-xs font-bold text-accent">
            D
          </span>
          <span className="text-sm font-semibold tracking-[0.18em] text-ink uppercase">DSC</span>
        </Link>

        <nav aria-label="Primary" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex items-center gap-1 text-sm">
            {NAV.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-1.5 transition-colors",
                      active
                        ? "bg-panel-2 text-ink"
                        : "text-muted hover:bg-panel-2/60 hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ChainSwitcher />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
