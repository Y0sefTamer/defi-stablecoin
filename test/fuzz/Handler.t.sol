// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DSCEngine} from "../../src/DSCEngine.sol";
import {DecentralizedStableCoin} from "../../src/DecentralizedStableCoin.sol";
import {ERC20Mock} from "../mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Handler
 * @author Yosef Tamer
 * @notice Drives the DSC engine with a bounded set of actions for the stateful invariant suite.
 *
 * @dev The invariant profile runs with `fail_on_revert = true`, so every action is written to
 * never revert: amounts are bounded against the current on-chain state before the call is made
 * and actions that cannot succeed are skipped instead of reverting.
 *
 * @dev Because DSCEngine does not expose per-user collateral balances, the handler keeps its own
 * ghost accounting of every deposit and withdrawal. The invariant suite compares those ghosts
 * against the engine's real token balances and per-account values.
 */
contract Handler is Test {
    /// @dev Price bounds for the mock feeds, expressed with the feeds' 8 decimals.
    uint256 private constant MIN_PRICE = 500e8;
    uint256 private constant MAX_PRICE = 4_000e8;

    uint256 private constant ACTOR_FUNDING = 1_000e18;
    uint256 private constant ACTOR_LOW_BALANCE = 1e18;
    uint256 private constant ACTOR_COUNT = 4;

    /// @dev Safety margins that absorb the 1 wei rounding differences between the handler's
    /// view math and the engine's internal math when simulating whether a call will succeed.
    uint256 private constant HEALTH_FACTOR_MARGIN = 1e6;

    DSCEngine public immutable engine;
    DecentralizedStableCoin public immutable dsc;

    address[] public actors;
    address[] public tokens;
    mapping(address token => MockV3Aggregator priceFeed) public priceFeeds;

    uint256 public immutable PRECISION;
    uint256 public immutable LIQUIDATION_THRESHOLD;
    uint256 public immutable LIQUIDATION_PRECISION;
    uint256 public immutable LIQUIDATION_BONUS;
    uint256 public immutable MIN_HEALTH_FACTOR;

    /// @notice Total collateral the protocol should be holding, tracked per token.
    mapping(address token => uint256 amount) public ghost_totalDeposited;
    /// @notice Collateral recorded per actor and token.
    mapping(address actor => mapping(address token => uint256 amount)) public ghost_actorDeposited;
    /// @notice Health factor of an actor right after its last successful action.
    mapping(address actor => uint256 healthFactor) public ghost_healthFactorSnapshot;
    /// @notice Price of each collateral token right after an actor's last successful action.
    mapping(address actor => mapping(address token => uint256 price)) public ghost_priceSnapshot;

    uint256 public ghost_liquidations;
    uint256 public ghost_priceUpdates;
    uint256 public ghost_liquidationHealthFactorDecreases;

    constructor(DSCEngine _engine) {
        engine = _engine;
        dsc = DecentralizedStableCoin(_engine.getDsc());

        PRECISION = _engine.getPrecision();
        LIQUIDATION_THRESHOLD = _engine.getLiquidationThreshold();
        LIQUIDATION_PRECISION = _engine.getLiquidationPrecision();
        LIQUIDATION_BONUS = _engine.getLiquidationBonus();
        MIN_HEALTH_FACTOR = _engine.getMinHealthFactor();

        tokens = _engine.getCollateralTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            priceFeeds[tokens[i]] = MockV3Aggregator(_engine.getCollateralTokenPriceFeed(tokens[i]));
            // Reserve used to top up actors as they drain their balances.
            ERC20Mock(tokens[i]).mint(address(this), 1e30);
        }

        for (uint256 i = 0; i < ACTOR_COUNT; i++) {
            // forge-lint: disable-next-line(unsafe-typecast)
            address actor = address(uint160(0xA000 + i));
            vm.label(actor, string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);

            for (uint256 j = 0; j < tokens.length; j++) {
                ERC20Mock(tokens[j]).mint(actor, ACTOR_FUNDING);
                vm.prank(actor);
                IERC20(tokens[j]).approve(address(engine), type(uint256).max);
            }

            vm.prank(actor);
            dsc.approve(address(engine), type(uint256).max);

            _snapshot(actor);
        }
    }

    //////////////////////
    // Actor Actions    //
    //////////////////////

    /// @notice Deposits collateral on behalf of a random actor.
    function depositCollateral(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        (address actor, address token) = _pick(actorSeed, tokenSeed);
        _topUp(actor, token);

        amount = bound(amount, 1, IERC20(token).balanceOf(actor));

        vm.prank(actor);
        engine.depositCollateral(token, amount);

        _recordDeposit(actor, token, amount);
    }

    /// @notice Deposits collateral and mints DSC on behalf of a random actor.
    function depositCollateralAndMintDsc(uint256 actorSeed, uint256 tokenSeed, uint256 amount, uint256 dscAmount)
        external
    {
        (address actor, address token) = _pick(actorSeed, tokenSeed);
        _topUp(actor, token);

        amount = bound(amount, 1, IERC20(token).balanceOf(actor));

        uint256 maxDsc = _maxAdditionalDscAfterDeposit(actor, token, amount);
        if (maxDsc == 0) return;
        dscAmount = bound(dscAmount, 1, maxDsc);

        vm.prank(actor);
        engine.depositCollateralAndMintDsc(token, amount, dscAmount);

        _recordDeposit(actor, token, amount);
    }

    /// @notice Mints DSC for a random actor without breaking its health factor.
    function mintDsc(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);

        uint256 maxDsc = _maxAdditionalDsc(actor);
        if (maxDsc == 0) return;
        amount = bound(amount, 1, maxDsc);

        vm.prank(actor);
        engine.mintDsc(amount);

        _snapshot(actor);
    }

    /// @notice Redeems collateral for a random actor without breaking its health factor.
    function redeemCollateral(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        (address actor, address token) = _pick(actorSeed, tokenSeed);

        uint256 maxRedeem = _maxRedeem(actor, token, _debtOf(actor));
        if (maxRedeem == 0) return;
        amount = bound(amount, 1, maxRedeem);

        vm.prank(actor);
        engine.redeemCollateral(token, amount);

        _recordWithdrawal(actor, token, amount);
    }

    /// @notice Burns DSC for a random actor.
    /// @dev An underwater account must burn at least `debt - adjustedCollateralValue` to pass the
    /// engine's post-burn health factor check, otherwise the call reverts.
    function burnDsc(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);

        uint256 debt = _debtOf(actor);
        uint256 maxBurn = _min(debt, dsc.balanceOf(actor));
        uint256 minBurn = 1;

        uint256 maxDebt = _adjustedCollateralValue(_collateralValueOf(actor));
        if (maxDebt < debt) minBurn = debt - maxDebt;

        if (maxBurn < minBurn) return;
        amount = bound(amount, minBurn, maxBurn);

        vm.prank(actor);
        engine.burnDsc(amount);

        _snapshot(actor);
    }

    /// @notice Burns DSC and redeems collateral in a single call for a random actor.
    function redeemCollateralForDsc(uint256 actorSeed, uint256 tokenSeed, uint256 amount, uint256 dscToBurn) external {
        (address actor, address token) = _pick(actorSeed, tokenSeed);

        uint256 debt = _debtOf(actor);
        uint256 maxBurn = _min(debt, dsc.balanceOf(actor));
        if (maxBurn == 0) return;
        dscToBurn = bound(dscToBurn, 1, maxBurn);

        uint256 maxRedeem = _maxRedeem(actor, token, debt - dscToBurn);
        if (maxRedeem == 0) return;
        amount = bound(amount, 1, maxRedeem);

        vm.prank(actor);
        engine.redeemCollateralForDsc(token, amount, dscToBurn);

        _recordWithdrawal(actor, token, amount);
    }

    /// @notice Liquidates an unhealthy actor, if a valid liquidation exists.
    function liquidate(uint256 liquidatorSeed, uint256 userSeed, uint256 tokenSeed, uint256 debtToCover) external {
        address liquidator = _actor(liquidatorSeed);
        address user = _actor(userSeed);
        address token = tokens[tokenSeed % tokens.length];

        // Self-liquidation can leave the caller below the minimum health factor.
        if (liquidator == user) return;

        uint256 userDebt = _debtOf(user);
        if (userDebt == 0) return;

        uint256 healthFactorBefore = engine.getHealthFactorFor(user);
        if (healthFactorBefore >= MIN_HEALTH_FACTOR) return;

        uint256 maxCover = _min(userDebt, dsc.balanceOf(liquidator));
        maxCover = _capCoverToUserCollateral(user, token, maxCover);
        if (maxCover == 0) return;

        debtToCover = bound(debtToCover, 1, maxCover);
        if (!_liquidationImproves(user, token, debtToCover, healthFactorBefore)) {
            debtToCover = maxCover;
            if (!_liquidationImproves(user, token, debtToCover, healthFactorBefore)) return;
        }

        uint256 collateralOut = _collateralOutForDebt(token, debtToCover);
        if (!_liquidatorIsHealthy(liquidator)) return;

        vm.prank(liquidator);
        engine.liquidate(token, user, debtToCover);

        ghost_liquidations++;
        ghost_actorDeposited[user][token] -= collateralOut;
        ghost_totalDeposited[token] -= collateralOut;

        if (engine.getHealthFactorFor(user) <= healthFactorBefore) {
            ghost_liquidationHealthFactorDecreases++;
        }

        _snapshot(user);
        _snapshot(liquidator);
    }

    /// @notice Moves a collateral price feed within a sane band so liquidations can happen.
    function setPrice(uint256 tokenSeed, uint256 newPrice) external {
        address token = tokens[tokenSeed % tokens.length];
        int256 price = int256(bound(newPrice, MIN_PRICE, MAX_PRICE));

        priceFeeds[token].updateAnswer(price);
        ghost_priceUpdates++;
    }

    //////////////////////
    // View Helpers     //
    //////////////////////

    function getActors() external view returns (address[] memory) {
        return actors;
    }

    function getTokens() external view returns (address[] memory) {
        return tokens;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    /// @notice Price of a collateral token, in the feed's own decimals.
    function priceOf(address token) external view returns (uint256) {
        return uint256(priceFeeds[token].latestAnswer());
    }

    //////////////////////
    // Internal Helpers //
    //////////////////////

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _pick(uint256 actorSeed, uint256 tokenSeed) private view returns (address actor, address token) {
        actor = actors[actorSeed % actors.length];
        token = tokens[tokenSeed % tokens.length];
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _debtOf(address actor) private view returns (uint256 debt) {
        (debt,) = engine.getAccountInformation(actor);
    }

    function _collateralValueOf(address actor) private view returns (uint256 value) {
        (, value) = engine.getAccountInformation(actor);
    }

    function _adjustedCollateralValue(uint256 collateralValueInUsd) private view returns (uint256) {
        return (collateralValueInUsd * LIQUIDATION_THRESHOLD) / LIQUIDATION_PRECISION;
    }

    /// @dev Largest amount of additional DSC an actor can mint and stay at or above the minimum health factor.
    function _maxAdditionalDsc(address actor) private view returns (uint256) {
        uint256 maxDebt = _adjustedCollateralValue(_collateralValueOf(actor));
        uint256 debt = _debtOf(actor);
        return maxDebt > debt ? maxDebt - debt : 0;
    }

    /// @dev Same as `_maxAdditionalDsc`, but including collateral that is about to be deposited.
    function _maxAdditionalDscAfterDeposit(address actor, address token, uint256 amount)
        private
        view
        returns (uint256)
    {
        uint256 collateralValue = _collateralValueOf(actor) + engine.getUsdValue(token, amount);
        uint256 maxDebt = _adjustedCollateralValue(collateralValue);
        uint256 debt = _debtOf(actor);
        return maxDebt > debt ? maxDebt - debt : 0;
    }

    /// @dev Largest amount of `token` an actor can redeem while keeping its health factor above 1.0.
    function _maxRedeem(address actor, address token, uint256 remainingDebt) private view returns (uint256) {
        uint256 deposited = ghost_actorDeposited[actor][token];
        if (deposited == 0) return 0;
        if (remainingDebt == 0) return deposited;

        uint256 maxDebt = _adjustedCollateralValue(_collateralValueOf(actor));
        if (maxDebt <= remainingDebt) return 0;

        // (collateralValue - redeemableUsd) * threshold / precision must stay >= remainingDebt.
        uint256 redeemableUsd = ((maxDebt - remainingDebt) * LIQUIDATION_PRECISION) / LIQUIDATION_THRESHOLD;
        if (redeemableUsd <= HEALTH_FACTOR_MARGIN) return 0;
        redeemableUsd -= HEALTH_FACTOR_MARGIN;

        uint256 amount = engine.getTokenAmountFromUsd(token, redeemableUsd);
        return _min(amount, deposited);
    }

    /// @dev Collateral (including the liquidation bonus) handed to a liquidator for `dscAmount`.
    function _collateralOutForDebt(address token, uint256 dscAmount) private view returns (uint256) {
        uint256 tokenAmount = engine.getTokenAmountFromUsd(token, dscAmount);
        return tokenAmount + (tokenAmount * LIQUIDATION_BONUS) / LIQUIDATION_PRECISION;
    }

    /// @dev Shrinks `cover` until the bonus inclusive payout fits in the user's position.
    function _capCoverToUserCollateral(address user, address token, uint256 cover) private view returns (uint256) {
        uint256 deposited = ghost_actorDeposited[user][token];

        for (uint256 i = 0; i < 8 && cover > 0; i++) {
            uint256 collateralOut = _collateralOutForDebt(token, cover);
            if (collateralOut <= deposited) break;
            cover = (cover * deposited) / collateralOut;
        }

        if (cover > 0 && _collateralOutForDebt(token, cover) > deposited) return 0;
        return cover;
    }

    /// @dev Mirrors the engine's health factor math to pre-check `liquidate`'s strict improvement rule.
    function _liquidationImproves(address user, address token, uint256 cover, uint256 healthFactorBefore)
        private
        view
        returns (bool)
    {
        uint256 collateralOut = _collateralOutForDebt(token, cover);
        // `liquidate` reverts with DSCEngine__NeedsMoreThanZero when the seized collateral rounds to 0.
        if (collateralOut == 0) return false;
        if (collateralOut > ghost_actorDeposited[user][token]) return false;

        uint256 collateralValue = _collateralValueOf(user);
        uint256 collateralOutUsd = engine.getUsdValue(token, collateralOut);
        if (collateralOutUsd >= collateralValue) return false;

        uint256 remainingDebt = _debtOf(user) - cover;
        if (remainingDebt == 0) return true;

        uint256 newCollateralValue = collateralValue - collateralOutUsd;
        uint256 healthFactorAfter = (_adjustedCollateralValue(newCollateralValue) * PRECISION) / remainingDebt;
        return healthFactorAfter > healthFactorBefore + HEALTH_FACTOR_MARGIN;
    }

    /// @dev The liquidator must remain healthy after the liquidation (`_revertIfHealthFactorIsBroken(msg.sender)`).
    /// @dev `liquidate` only spends the caller's DSC: the seized collateral is sent to the caller's
    /// wallet, not credited as engine collateral, so the caller's health factor is unchanged.
    function _liquidatorIsHealthy(address liquidator) private view returns (bool) {
        return engine.getHealthFactorFor(liquidator) >= MIN_HEALTH_FACTOR;
    }

    function _recordDeposit(address actor, address token, uint256 amount) private {
        ghost_actorDeposited[actor][token] += amount;
        ghost_totalDeposited[token] += amount;
        _snapshot(actor);
    }

    function _recordWithdrawal(address actor, address token, uint256 amount) private {
        ghost_actorDeposited[actor][token] -= amount;
        ghost_totalDeposited[token] -= amount;
        _snapshot(actor);
    }

    /// @dev Records the state an actor must be able to recover from if prices move against it later.
    function _snapshot(address actor) private {
        ghost_healthFactorSnapshot[actor] = engine.getHealthFactorFor(actor);

        for (uint256 i = 0; i < tokens.length; i++) {
            ghost_priceSnapshot[actor][tokens[i]] = uint256(priceFeeds[tokens[i]].latestAnswer());
        }
    }

    function _topUp(address actor, address token) private {
        if (IERC20(token).balanceOf(actor) < ACTOR_LOW_BALANCE) {
            ERC20Mock(token).mint(actor, ACTOR_FUNDING);
        }
    }
}
