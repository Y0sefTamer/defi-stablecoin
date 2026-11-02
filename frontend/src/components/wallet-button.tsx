"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useConnect, useConnectors, useDisconnect } from "wagmi";

import { useMounted } from "@/hooks/use-mounted";
import { describeError } from "@/lib/errors";
import { truncateAddress } from "@/lib/format";
import { Button } from "./ui";

export function WalletButton() {
  const mounted = useMounted();
  const { address, isConnected, isConnecting } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error: connectError, reset } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [address]);

  // Render a stable placeholder on the server so hydration never mismatches.
  if (!mounted) {
    return (
      <div className="h-9 w-32 animate-pulse rounded-lg bg-panel-2" aria-hidden="true" />
    );
  }

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          onClick={() => {
            reset();
            if (injected) connect({ connector: injected });
          }}
          disabled={isPending || isConnecting || !injected}
        >
          {isPending || isConnecting ? "Connecting…" : "Connect wallet"}
        </Button>
        {connectError ? (
          <span className="max-w-56 text-right text-[11px] text-danger">
            {describeError(connectError).title}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="tabular inline-flex items-center gap-2 rounded-lg border border-line-strong bg-panel-2 px-3 py-2 text-xs text-ink transition-colors hover:border-accent/50"
      >
        <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        {address ? truncateAddress(address) : "Connected"}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-line-strong bg-panel p-3 shadow-xl"
        >
          <p className="text-[11px] font-medium tracking-wider text-faint uppercase">Account</p>
          <p className="tabular mt-1 text-xs break-all text-ink">{address}</p>
          <div className="mt-3 flex flex-col gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copyAddress()}>
              {copied ? "Copied" : "Copy address"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
