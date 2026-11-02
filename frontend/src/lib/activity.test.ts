import { describe, expect, it } from "vitest";
import type { Address, Hash } from "viem";

import { classifyActivity, type ActivityEvent } from "./activity";

const ACCOUNT = "0x00000000000000000000000000000000000000aa" as Address;
const OTHER = "0x00000000000000000000000000000000000000bb" as Address;
const ENGINE = "0x00000000000000000000000000000000000000cc" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const WETH = "0x00000000000000000000000000000000000000dd" as Address;
const DSC = "0x00000000000000000000000000000000000000ee" as Address;

let logIndex = 0;

function tx(hash: string): Hash {
  return `0x${hash.padStart(64, "0")}` as Hash;
}

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  logIndex += 1;
  return {
    type: "collateral-deposited",
    blockNumber: 100n,
    logIndex,
    transactionHash: tx(`1${logIndex}`),
    user: ACCOUNT,
    token: WETH,
    amount: 10n ** 18n,
    ...overrides,
  };
}

describe("classifyActivity", () => {
  it("keeps deposits made by the account", () => {
    const [item] = classifyActivity([event({})], ACCOUNT);
    expect(item?.kind).toBe("deposit");
    expect(item?.amount).toBe(10n ** 18n);
    expect(item?.token).toBe(WETH);
  });

  it("treats a self-redeem as a withdrawal", () => {
    const [item] = classifyActivity(
      [
        event({
          type: "collateral-redeemed",
          user: ACCOUNT,
          counterparty: ACCOUNT,
        }),
      ],
      ACCOUNT,
    );
    expect(item?.kind).toBe("withdraw");
  });

  it("treats a redeem to someone else as a seizure", () => {
    const [item] = classifyActivity(
      [
        event({
          type: "collateral-redeemed",
          user: ACCOUNT,
          counterparty: OTHER,
        }),
      ],
      ACCOUNT,
    );
    expect(item?.kind).toBe("liquidation-seized");
    expect(item?.counterparty).toBe(OTHER);
  });

  it("treats a redeem from someone else as received collateral", () => {
    const [item] = classifyActivity(
      [
        event({
          type: "collateral-redeemed",
          user: OTHER,
          counterparty: ACCOUNT,
        }),
      ],
      ACCOUNT,
    );
    expect(item?.kind).toBe("liquidation-received");
    expect(item?.counterparty).toBe(OTHER);
  });

  it("infers a mint from a DSC transfer out of the zero address", () => {
    const [item] = classifyActivity(
      [
        event({
          type: "dsc-transfer",
          token: undefined,
          from: ZERO,
          to: ACCOUNT,
          amount: 500n * 10n ** 18n,
        }),
      ],
      ACCOUNT,
    );
    expect(item?.kind).toBe("borrow");
  });

  it("infers a repayment from a DSC transfer to the zero address", () => {
    const [item] = classifyActivity(
      [
        event({
          type: "dsc-transfer",
          token: undefined,
          from: ACCOUNT,
          to: ZERO,
          amount: 500n * 10n ** 18n,
        }),
      ],
      ACCOUNT,
    );
    expect(item?.kind).toBe("repay");
  });

  it("infers a repayment from a DSC transfer to the engine", () => {
    const [item] = classifyActivity(
      [
        event({
          type: "dsc-transfer",
          token: undefined,
          from: ACCOUNT,
          to: ENGINE,
        }),
      ],
      ACCOUNT,
      ENGINE,
    );
    expect(item?.kind).toBe("repay");
  });

  it("classifies a regular transfer as sent or received", () => {
    const [sent] = classifyActivity(
      [
        event({
          type: "dsc-transfer",
          token: undefined,
          from: ACCOUNT,
          to: OTHER,
        }),
      ],
      ACCOUNT,
    );
    const [received] = classifyActivity(
      [
        event({
          type: "dsc-transfer",
          token: undefined,
          from: OTHER,
          to: ACCOUNT,
        }),
      ],
      ACCOUNT,
    );

    expect(sent?.kind).toBe("transfer-out");
    expect(received?.kind).toBe("transfer-in");
  });

  it("drops an inferred repayment that is only the liquidator paying the debt", () => {
    const hash = tx("99");
    const items = classifyActivity(
      [
        event({
          type: "collateral-redeemed",
          user: OTHER,
          counterparty: ACCOUNT,
          transactionHash: hash,
        }),
        event({
          type: "dsc-transfer",
          token: undefined,
          from: ACCOUNT,
          to: ZERO,
          transactionHash: hash,
          logIndex: 7,
        }),
      ],
      ACCOUNT,
    );

    expect(items.map((item) => item.kind)).toEqual(["liquidation-received"]);
  });

  it("ignores events that do not involve the account", () => {
    const items = classifyActivity(
      [
        event({ user: OTHER }),
        event({ type: "collateral-redeemed", user: OTHER, counterparty: ZERO }),
        event({ type: "dsc-transfer", from: OTHER, to: ZERO, token: DSC }),
      ],
      ACCOUNT,
    );
    expect(items).toHaveLength(0);
  });

  it("sorts newest block first and keeps log order inside a block", () => {
    const items = classifyActivity(
      [
        event({ blockNumber: 100n, logIndex: 1, transactionHash: tx("01") }),
        event({ blockNumber: 200n, logIndex: 0, transactionHash: tx("02") }),
        event({ blockNumber: 100n, logIndex: 3, transactionHash: tx("03") }),
      ],
      ACCOUNT,
    );

    expect(items.map((item) => item.blockNumber)).toEqual([200n, 100n, 100n]);
    expect(items[1]?.id.endsWith("-3")).toBe(true);
  });
});
