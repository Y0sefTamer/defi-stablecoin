"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { useChainSelection } from "./use-chain-selection";
import { describeError, type TxError } from "@/lib/errors";

type MutateFn = ReturnType<typeof useWriteContract>["mutate"];
export type WriteRequest = Parameters<MutateFn>[0];

export type SimulationLike = {
  data?: { request: WriteRequest } | undefined;
  error: unknown | null;
  isFetching: boolean;
};

export type TxStatus =
  | "idle"
  | "simulating"
  | "awaiting-wallet"
  | "pending"
  | "confirmed"
  | "failed";

export function useTxFlow(simulation: SimulationLike) {
  const queryClient = useQueryClient();
  const { chainId } = useChainSelection();

  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: Boolean(write.data) },
  });

  useEffect(() => {
    if (!receipt.isSuccess) return;
    void queryClient.invalidateQueries({ queryKey: ["protocol"] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
    void queryClient.invalidateQueries({ queryKey: ["borrowers"] });
  }, [receipt.isSuccess, queryClient]);

  const error: unknown =
    simulation.error ?? write.error ?? (receipt.isError ? receipt.error : undefined);

  let status: TxStatus = "idle";
  if (simulation.isFetching) status = "simulating";
  else if (write.isPending) status = "awaiting-wallet";
  else if (write.data && receipt.isLoading) status = "pending";
  else if (receipt.isSuccess) status = "confirmed";
  else if (error) status = "failed";

  const described: TxError | undefined = error ? describeError(error) : undefined;

  return {
    status,
    isBusy: status === "simulating" || status === "awaiting-wallet" || status === "pending",
    isConfirmed: status === "confirmed",
    canSend: Boolean(simulation.data) && !simulation.isFetching && status !== "pending",
    hash: write.data,
    error: described,
    chainId,
    send: () => {
      if (!simulation.data) return;
      // `simulateContract` already produced this request for the current chain;
      // the cast only reconciles two instantiations of the same wagmi type.
      write.mutate(
        simulation.data.request as unknown as Parameters<typeof write.mutate>[0],
      );
    },
    reset: () => {
      write.reset();
    },
  };
}
