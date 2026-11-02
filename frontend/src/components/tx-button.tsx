"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { explorerTxUrl } from "@/config/chains";
import { useTxFlow, type SimulationLike } from "@/hooks/use-write-flow";
import { truncateAddress } from "@/lib/format";
import { Button, Notice, cn } from "./ui";

export function TxButton({
  simulation,
  label,
  pendingLabel = "Confirming…",
  disabled,
  reason,
  variant = "primary",
  size = "md",
  className,
  onSuccess,
}: {
  simulation: SimulationLike;
  label: ReactNode;
  pendingLabel?: ReactNode;
  disabled?: boolean;
  /** Shown under the button when disabled, so the user knows what is missing. */
  reason?: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  className?: string;
  onSuccess?: () => void;
}) {
  const tx = useTxFlow(simulation);
  const explorer = tx.hash ? explorerTxUrl(tx.chainId, tx.hash) : undefined;

  const successRef = useRef(onSuccess);
  useEffect(() => {
    successRef.current = onSuccess;
  }, [onSuccess]);

  const notified = useRef(false);

  useEffect(() => {
    if (!tx.isConfirmed) {
      notified.current = false;
      return;
    }
    if (notified.current) return;
    notified.current = true;
    successRef.current?.();
  }, [tx.isConfirmed]);

  const text =
    tx.status === "simulating"
      ? "Checking…"
      : tx.status === "awaiting-wallet"
        ? "Confirm in wallet…"
        : tx.status === "pending"
          ? pendingLabel
          : tx.status === "confirmed"
            ? "Done"
            : label;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button
        onClick={tx.send}
        disabled={disabled || !tx.canSend || tx.status === "confirmed"}
        variant={variant}
        size={size}
      >
        {text}
      </Button>

      {disabled && reason ? <p className="text-xs text-muted">{reason}</p> : null}

      {tx.hash ? (
        <p className="tabular text-xs text-muted">
          {tx.status === "confirmed" ? "Confirmed" : "Submitted"}:{" "}
          {explorer ? (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent hover:underline"
            >
              {truncateAddress(tx.hash, 10, 8)}
            </a>
          ) : (
            truncateAddress(tx.hash, 10, 8)
          )}
        </p>
      ) : null}

      {tx.error && !tx.error.isRejection ? (
        <Notice tone="danger" title={tx.error.title}>
          {tx.error.detail}
        </Notice>
      ) : null}
      {tx.error?.isRejection ? <p className="text-xs text-muted">{tx.error.title}</p> : null}
    </div>
  );
}
