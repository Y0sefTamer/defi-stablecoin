"use client";

import { Card, CardHeader } from "./ui";
import { WalletButton } from "./wallet-button";

export function ConnectPrompt({
  title = "Connect a wallet to continue",
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="flex flex-col items-start gap-3 px-5 py-6">
        <p className="max-w-prose text-sm text-muted">
          {children ??
            "You can browse markets without a wallet, but deposits, mints, repayments and liquidations need a signer."}
        </p>
        <WalletButton />
      </div>
    </Card>
  );
}
