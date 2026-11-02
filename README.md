# DSC — a stablecoin that cannot be bailed out

> **1 DSC ≈ $1, backed only by WETH and WBTC. No governance, no fees, no admin who can mint.**

[![CI](https://github.com/Y0sefTamer/my-defi-protocol/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/Y0sefTamer/my-defi-protocol/actions/workflows/test.yml)

A minimal, exogenous, overcollateralized stablecoin engine written in Solidity and tested with Foundry.
It is a stripped-down descendant of MakerDAO's DSS: you lock crypto, you borrow dollars, and if your
position drifts underwater anyone can buy your collateral at a discount.

There is exactly one rule this codebase exists to enforce:

> **At no point may the dollar value of all collateral, discounted by the liquidation threshold, be
> less than the dollar value of all DSC in existence.**

Everything below is machinery in service of that sentence.

**Status: reference implementation.** Sepolia and Anvil only, not audited, no real value at risk.
The honest list of what this system does *not* protect against is at the bottom — read it before
listing this anywhere.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Mechanics in formulas](#mechanics-in-formulas)
- [A worked position](#a-worked-position)
- [Testing](#testing)
- [Deploying](#deploying)
- [Threat model and known limitations](#threat-model-and-known-limitations)
- [Repository map](#repository-map)
- [Footprint](#footprint)

---

## What it does

| You want to | Call | What the engine checks |
|---|---|---|
| Lock collateral | `depositCollateral(token, amount)` | amount > 0, token is a supported feed |
| Lock collateral and borrow in one tx | `depositCollateralAndMintDsc(token, amount, dsc)` | both of the above, then health factor |
| Borrow dollars | `mintDsc(amount)` | resulting health factor ≥ 1.0 |
| Repay debt | `burnDsc(amount)` | resulting health factor ≥ 1.0 |
| Unlock collateral | `redeemCollateral(token, amount)` | resulting health factor ≥ 1.0 |
| Repay and unlock in one tx | `redeemCollateralForDsc(token, amount, dsc)` | both, checked once at the end |
| Profit from someone's bad debt | `liquidate(collateral, user, debtToCover)` | user HF < 1.0, HF strictly improves, caller stays healthy |

DSC has no transfer fee, no rebasing, no blacklist, no pause and no upgrade path. Minting and burning
are `onlyOwner`, and the owner is the engine itself — after `dsc.transferOwnership(address(dscEngine))`
in the deploy script, **nobody holds a key that can create DSC**. That is the point.

---

## Architecture

```mermaid
flowchart LR
    LP[Liquidity provider] -- "depositCollateral / redeemCollateral" --> E[DSCEngine]
    BR[Borrower] -- "mintDsc / burnDsc" --> E
    LQ[Liquidator] -- "liquidate" --> E

    E -- "mint / burn (onlyOwner)" --> D[(DecentralizedStableCoin)]
    E -- "transferFrom / transfer" --> W[WETH]
    E -- "transferFrom / transfer" --> B[WBTC]
    E -- "staleCheckLatestRoundData()" -.-> O[OracleLib]
    O -.-> F1[WETH/USD feed]
    O -.-> F2[WBTC/USD feed]
```

Two contracts and one library, no proxy, no factory, no registry:

- **`DSCEngine`** — all accounting. Collateral per user per token, debt per user, price feeds, health
  factor, liquidation math. `ReentrancyGuard` on every entry point that moves collateral,
  checks-effects-interactions ordering, custom errors everywhere.
- **`DecentralizedStableCoin`** — a `ERC20Burnable` + `Ownable` token. It refuses zero amounts, zero
  recipients and burns above balance, and it can only be driven by the engine.
- **`OracleLib`** — a Chainlink wrapper that rejects a price when `updatedAt == 0`,
  `answeredInRound < roundId`, or the answer is older than 3 hours. Its functions are `public`, so
  `DSCEngine` deploys with a library link rather than inlining them.

---

## Mechanics in formulas

Constants are compile-time and exposed read-only (`getPrecision()`, `getLiquidationThreshold()`, ...):

| Constant | Value | Meaning |
|---|---|---|
| `PRECISION` | `1e18` | fixed point base |
| `ADDITIONAL_FEED_PRECISION` | `1e10` | lifts 8-decimal Chainlink answers to 18 |
| `LIQUIDATION_THRESHOLD` | `50` / `100` | collateral counts at 50%, i.e. 200% overcollateralized |
| `LIQUIDATION_BONUS` | `10` / `100` | liquidators seize 10% extra collateral |
| `MIN_HEALTH_FACTOR` | `1e18` | the line below which a position is liquidatable |
| `TIMEOUT` (`OracleLib`) | `3 hours` | a feed older than this makes every price read revert |

**Collateral value** — `price` is read through `OracleLib.staleCheckLatestRoundData()`, never raw
`latestRoundData()`, so a stale or malformed answer reverts instead of being priced in.

```
usdValue(token, amount)   = price * 1e10 * amount / 1e18
accountValue(user)        = Σ usdValue(token, balance[user][token])
```

**Health factor** (`type(uint256).max` when there is no debt)

```
HF(user) = (accountValue(user) * 50 / 100) * 1e18 / dscMinted[user]
```

**Minting capacity**

```
maxAdditionalDsc(user) = accountValue(user) * 50 / 100 - dscMinted[user]
```

**Liquidation payout**

```
collateralSeized = debtToCover * 1e18 / (price * 1e10)      // DSC -> tokens
bonus            = collateralSeized * 10 / 100
payout           = collateralSeized + bonus
```

`liquidate` then requires `HF(user)` to strictly increase and the liquidator's own health factor to
remain ≥ 1.0, otherwise it reverts with `DSCEngine__HealthFactorNotImproved` / `DSCEngine__BreaksHealthFactor`.

---

## A worked position

With WETH at $2,000 (the test fixture):

```
deposit 10 WETH                      -> account value   20,000 USD
                                     -> borrow capacity 10,000 DSC
mint 10,000 DSC                      -> HF = 1.000  (exactly on the line)
WETH drops to $1,500                 -> account value   15,000 USD
                                     -> HF = 0.750  (liquidatable)
liquidate 1,000 DSC of the debt      -> seizes 0.7333 WETH (0.6666 + 10% bonus)
                                     -> user debt 9,000 DSC, HF improves to 0.772
```

Two things fall out of that arithmetic, and both are real properties of the design:

1. **Liquidation only rescues positions above `HF ≈ 0.55`.** With `a` = adjusted collateral value and
   `d` = debt, a partial liquidation of `x` improves the ratio only when `a > 0.55·d`. Below that
   line every partial liquidation makes the position *worse*, and a full one would need more
   collateral than the user has, so the call reverts with `HealthFactorNotImproved` or an arithmetic
   panic. A max-leveraged position that loses more than ~45% of its value is therefore stuck: the
   engine's own comment admits this, and the invariant suite documents it as a known limitation.
2. **Above that line liquidations always pay.** The 50% threshold plus the 10% bonus hands the caller
   about 1.10× the dollar value they burn, which is what defends the peg without an incentive
   committee.

---

## Testing

The suite is the interesting half of this repository. `forge test` runs **82 tests across 6 suites** in
about 82 seconds locally, and the bulk of that is the invariant campaign.

| Layer | Where | What it proves |
|---|---|---|
| Unit | `test/unit/DSCEngineTest.t.sol` | every public function, every revert path, exact custom errors |
| Unit | `test/unit/DecentralizedStableCoinTest.t.sol` | mint/burn authorization and boundaries |
| Stateful fuzz | `test/fuzz/Invariant.t.sol` | mint/redeem/burn/liquidate boundaries against random amounts |
| Invariants | `test/fuzz/Invariant.t.sol` + `test/fuzz/Handler.t.sol` | protocol-wide properties over 16,384 random calls |
| Getters | `test/fuzz/Invariant.t.sol` | constants and wiring pinned independently of the getters |

### The invariants

`Handler` drives four actors through eight actions and moves the price feeds between $500 and $4,000.
Every action is pre-bounded against live state so the campaign runs with `fail_on_revert = true` and
**zero** reverts, and ghost accounting tracks deposits, health factors and prices.

| Invariant | Statement |
|---|---|
| `dscSupplyEqualsTotalDebt` | `dsc.totalSupply()` == Σ `dscMinted[user]` |
| `engineCollateralBalancesMatchRecordedDeposits` | engine token balance == Σ recorded deposits, per token |
| `accountInformationMatchesRecordedDeposits` | per-user value and HF equal the ghost deposits and the documented formula |
| `engineHoldsNoDsc` | every DSC the engine receives is burned; it never sits on a balance |
| `engineOwnsDsc` | the engine, not a human, is the DSC owner |
| `healthFactorOnlyFallsWithPrice` | `HF_now ≥ HF_snapshot × min(price_now / price_snapshot)` — a user can only go underwater because the market moved, never because of an action sequence |
| `liquidationsImproveHealthFactor` | no liquidation ever left the liquidated user worse off |

The sixth one is the load-bearing invariant: because health factor is linear in collateral prices,
it rules out any action-driven path to undercollateralization — the only way a user can fall below
1.0 is the market moving against them.

```bash
forge build                      # compile
forge test                       # 82 tests: unit + fuzz + invariants
forge test --match-contract InvariantTest -vv   # deep-dive the campaign
forge test --match-test testFuzz_liquidateConservesValueAndPaysBonus -vvv
forge coverage                   # line/branch coverage report
forge fmt --check                # what CI enforces
```

Fuzz and invariant budgets come from `foundry.toml`:

| Setting | Local | CI (`FOUNDRY_PROFILE=ci`) |
|---|---|---|
| fuzz runs | 512 | 256 |
| invariant runs × depth | 128 × 128 | 128 × 256 |
| invariant calls | 16,384 | 32,768 |

---

## Deploying

No private keys live in this repository. `HelperConfig` reads `PRIVATE_KEY` from the environment for
Sepolia and falls back to Anvil's well-known development key on any other chain id.

```bash
# local chain with mock collateral + mock feeds (WETH $2,000, WBTC $1,000)
anvil
forge script script/DeployDSC.s.sol:DeployDSC --rpc-url http://localhost:8545 --broadcast

# Sepolia, real Chainlink feeds, real (testnet) WETH/WBTC
export SEPOLIA_RPC_URL="https://..."
export PRIVATE_KEY="..."                        # never commit this
forge script script/DeployDSC.s.sol:DeployDSC \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify \
  --etherscan-api-key "$ETHERSCAN_API_KEY" -vvvv
```

Network wiring (chain id 11155111 → Sepolia config, everything else → fresh mocks) lives in
`script/HelperConfig.s.sol`. Add a branch there for any new chain.

`OracleLib` exposes `public` functions, so it compiles to its own contract and `DSCEngine` carries a
library placeholder in its bytecode. `forge script` deploys and links it automatically. If you deploy
the bytecode by hand (e.g. with `forge create` or a factory), deploy `OracleLib` first and pass
`--libraries src/libraries/OracleLib.sol:OracleLib:<address>`, otherwise `DSCEngine` will revert on
every call that touches a price.

---

## Threat model and known limitations

This is a learning-grade implementation. The engine itself has no owner, so "admin rug" is not on the
list — but the following are, and they are honest:

| Severity | Issue | Where |
|---|---|---|
| High | No L2 sequencer uptime check. On an L2 a down sequencer can leave a feed that looks fresh on-chain while prices move elsewhere. | `OracleLib` |
| High | Positions below `HF ≈ 0.55` cannot be liquidated at all: partial liquidations worsen the ratio and a full one needs more collateral than exists, so the bad debt is permanent. | `liquidate` |
| Medium | Availability is all-or-nothing: one stale feed (> 3 hours) reverts every price read, freezing deposits, redemptions and liquidations protocol-wide. Deliberate, but a single point of failure. | `OracleLib` |
| Medium | Fee-on-transfer / rebasing collateral would desync accounting: deposits are credited before the transfer and the received amount is never measured. | `depositCollateral` |
| Medium | Dust liquidations revert with `DSCEngine__NeedsMoreThanZero` when seized collateral rounds to zero; the last wei of a debt can become uncollectable. | `_redeemCollateral` via `liquidate` |
| Low | Repaying while underwater requires burning at least `debt - adjustedCollateralValue`; partial repayment reverts. | `burnDsc` |
| Low | Underflow on over-redeem surfaces as `Panic(0x11)` instead of a named error. | `_redeemCollateral` |
| Low | No check that the feed answer is positive before `uint256(price)`; a negative answer would be read as an enormous price. | `getUsdValue`, `getTokenAmountFromUsd` |
| Low | The stale-price path is untested: mocks are born with a fresh timestamp and nothing warps time, so `OracleLib__StalePrice` never fires in CI. | `test/` |
| Info | Seized collateral is sent to the liquidator's wallet, not credited as engine collateral — frontends must read `balanceOf`, not engine accounting. | `_redeemCollateral` |
| Info | Constructor accepts an empty or duplicated token list. | `DSCEngine` |
| Info | `burnDsc` is not `nonReentrant` (safe today because DSC is a trusted immutable token). | `burnDsc` |

What is *not* a limitation: DSC cannot be minted by anyone but the engine, cannot be minted past the
health factor, cannot be burned from someone else's debt, and cannot be redeemed for collateral that
isn't there — the invariant suite tests all four continuously.

---

## Repository map

```
src/
  DSCEngine.sol                 collateral, debt, health factor, liquidation
  DecentralizedStableCoin.sol   ERC20 + burnable + owned by the engine
  libraries/
    OracleLib.sol               Chainlink wrapper: staleness + round sanity checks
script/
  DeployDSC.s.sol               deploys DSC, transfers ownership, returns the engine
  HelperConfig.s.sol            Sepolia addresses / Anvil mocks in one place
test/
  unit/                         function-by-function behaviour and revert paths
  fuzz/Handler.t.sol            stateful harness with ghost accounting
  fuzz/Invariant.t.sol          invariants + stateful fuzz tests + getter pins
  mocks/                        ERC20 (with failure toggles), DSC, V3 aggregator
```

Reading order for a newcomer: `src/DSCEngine.sol` → `_healthFactor` → `liquidate` → `OracleLib.sol` →
`Handler.t.sol` → `Invariant.t.sol`. That is the whole system in six stops.

---

## Footprint

| Contract | Deployed size | Unit tests |
|---|---|---|
| `DSCEngine` | 7,206 B | 60 |
| `DecentralizedStableCoin` | 5,029 B | 11 |
| `OracleLib` | 1,243 B | — (covered through `DSCEngine`) |

- Solidity `^0.8.20`, compiled with `0.8.33`, optimizer off (Foundry defaults), no via-IR.
- Dependencies: OpenZeppelin Contracts (ERC20, Ownable, ReentrancyGuard), Chainlink `AggregatorV3Interface`, forge-std.
- CI: `forge fmt --check`, `forge build --sizes`, `forge test -vvv` on every push and pull request.

MIT. Every file carries an SPDX header.
