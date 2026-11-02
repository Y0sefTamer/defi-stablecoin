import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DSC — decentralized stablecoin",
    template: "%s · DSC",
  },
  description:
    "A minimal, exogenous, overcollateralized stablecoin. Deposit WETH or WBTC, mint DSC against it, and watch the health factor that keeps the peg honest.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>
          <div className="grid-backdrop min-h-dvh">
            <SiteHeader />
            <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6">{children}</main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
