import { parseAbiItem, type Address, type Hash, type PublicClient } from "viem";

export type ActivityKind =
  | "deposit"
  | "withdraw"
  | "borrow"
  | "repay"
  | "liquidation-seized"
  | "liquidation-received"
  | "transfer-in"
  | "transfer-out";

export type ActivityEvent = {
  type: "collateral-deposited" | "collateral-redeemed" | "dsc-transfer";
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
  /** Actor the event is recorded for. */
  user: Address;
  token?: Address;
  counterparty?: Address;
  amount: bigint;
  from?: Address;
  to?: Address;
};

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  blockNumber: bigint;
  transactionHash: Hash;
  token?: Address;
  counterparty?: Address;
  amount: bigint;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const collateralDepositedEvent = parseAbiItem(
  "event CollateralDeposited(address indexed user, address indexed token, uint256 indexed amount)",
);
export const collateralRedeemedEvent = parseAbiItem(
  "event CollateralRedeemed(address indexed redeemFrom, address indexed redeemTo, address indexed token, uint256 amount)",
);
export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * Turns raw events into user-facing activity. The engine emits no dedicated
 * mint, burn or liquidation events, so they are inferred:
 *
 * - a redeem whose `redeemFrom` and `redeemTo` differ is a liquidation
 * - DSC transferred from the zero address is a borrow
 * - DSC transferred to the engine is a repayment (the engine burns it)
 */
export function classifyActivity(
  events: ActivityEvent[],
  account: Address,
  engine?: Address,
): ActivityItem[] {
  const normalized = account.toLowerCase();
  const engineAddress = engine?.toLowerCase();
  const items: ActivityItem[] = [];

  for (const event of events) {
    const base = {
      id: `${event.transactionHash}-${event.logIndex}`,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      token: event.token,
    };

    if (event.type === "collateral-deposited") {
      if (event.user.toLowerCase() !== normalized) continue;
      items.push({ ...base, kind: "deposit", amount: event.amount });
      continue;
    }

    if (event.type === "collateral-redeemed") {
      const from = event.user.toLowerCase();
      const to = event.counterparty?.toLowerCase();

      if (from === normalized && to === normalized) {
        items.push({ ...base, kind: "withdraw", amount: event.amount });
      } else if (from === normalized) {
        items.push({
          ...base,
          kind: "liquidation-seized",
          counterparty: event.counterparty,
          amount: event.amount,
        });
      } else if (to === normalized) {
        items.push({
          ...base,
          kind: "liquidation-received",
          counterparty: event.user,
          amount: event.amount,
        });
      }
      continue;
    }

    const from = event.from?.toLowerCase();
    const to = event.to?.toLowerCase();

    if (from === ZERO_ADDRESS && to === normalized) {
      items.push({ ...base, kind: "borrow", amount: event.amount });
    } else if (from === normalized && (to === ZERO_ADDRESS || to === engineAddress)) {
      items.push({ ...base, kind: "repay", amount: event.amount });
    } else if (from === normalized) {
      items.push({ ...base, kind: "transfer-out", counterparty: event.to, amount: event.amount });
    } else if (to === normalized) {
      items.push({ ...base, kind: "transfer-in", counterparty: event.from, amount: event.amount });
    }
  }

  // A liquidation pays the debt with the liquidator's DSC and seizes collateral in the
  // same transaction. Report the collateral leg only, not a phantom "repay".
  const liquidationTransactions = new Set(
    items.filter((item) => item.kind === "liquidation-received").map((item) => item.id.split("-")[0]),
  );
  const filtered = items.filter(
    (item) => !(item.kind === "repay" && liquidationTransactions.has(item.id.split("-")[0])),
  );

  return filtered.sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return b.id.localeCompare(a.id);
    return a.blockNumber > b.blockNumber ? -1 : 1;
  });
}

type FetchParams = {
  client: PublicClient;
  engine: Address;
  dsc: Address;
  account: Address;
  fromBlock: bigint;
  toBlock?: bigint;
  chunkSize?: number;
  onProgress?: (scannedTo: bigint, head: bigint) => void;
};

export async function fetchActivity({
  client,
  engine,
  dsc,
  account,
  fromBlock,
  toBlock,
  chunkSize = 10_000,
  onProgress,
}: FetchParams): Promise<ActivityItem[]> {
  const head = toBlock ?? (await client.getBlockNumber());
  const size = BigInt(Math.max(1, Math.floor(chunkSize)));
  const events: ActivityEvent[] = [];
  const seen = new Set<string>();

  for (let start = fromBlock; start <= head; start += size) {
    const end = start + size - 1n > head ? head : start + size - 1n;

    const [deposits, redeemedFrom, redeemedTo, dscOut, dscIn] = await Promise.all([
      client.getLogs({
        address: engine,
        event: collateralDepositedEvent,
        args: { user: account },
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: engine,
        event: collateralRedeemedEvent,
        args: { redeemFrom: account },
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: engine,
        event: collateralRedeemedEvent,
        args: { redeemTo: account },
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: dsc,
        event: transferEvent,
        args: { from: account },
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: dsc,
        event: transferEvent,
        args: { to: account },
        fromBlock: start,
        toBlock: end,
      }),
    ]);

    for (const log of deposits) {
      const { user, token, amount } = log.args;
      if (!user || !token || typeof amount !== "bigint") continue;
      const key = `${log.transactionHash}-${log.logIndex}-deposit`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        type: "collateral-deposited",
        user,
        token,
        amount,
        blockNumber: log.blockNumber ?? 0n,
        logIndex: Number(log.logIndex ?? 0),
        transactionHash: log.transactionHash ?? "0x",
      });
    }

    for (const log of [...redeemedFrom, ...redeemedTo]) {
      const { redeemFrom, redeemTo, token, amount } = log.args;
      if (!redeemFrom || !redeemTo || !token || typeof amount !== "bigint") continue;
      const key = `${log.transactionHash}-${log.logIndex}-redeem`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        type: "collateral-redeemed",
        user: redeemFrom,
        counterparty: redeemTo,
        token,
        amount,
        blockNumber: log.blockNumber ?? 0n,
        logIndex: Number(log.logIndex ?? 0),
        transactionHash: log.transactionHash ?? "0x",
      });
    }

    for (const log of [...dscOut, ...dscIn]) {
      const { from, to, value } = log.args;
      if (!from || !to || typeof value !== "bigint") continue;
      const key = `${log.transactionHash}-${log.logIndex}-transfer`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        type: "dsc-transfer",
        user: account,
        from,
        to,
        amount: value,
        blockNumber: log.blockNumber ?? 0n,
        logIndex: Number(log.logIndex ?? 0),
        transactionHash: log.transactionHash ?? "0x",
      });
    }

    onProgress?.(end, head);
  }

  return classifyActivity(events, account, engine);
}
