// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {DSCEngine} from "../../src/DSCEngine.sol";
import {DecentralizedStableCoin} from "../../src/DecentralizedStableCoin.sol";
import {ERC20Mock} from "../mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {Handler} from "./Handler.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DSCSystem
 * @notice Shared deterministic deployment used by the fuzz and invariant tests.
 * @dev The expected protocol constants are intentionally hardcoded here instead of being read
 * from the engine getters, so that a silently changed constant is caught by the tests.
 */
abstract contract DSCSystem is Test {
    uint256 internal constant PRECISION = 1e18;
    uint256 internal constant LIQUIDATION_THRESHOLD = 50;
    uint256 internal constant LIQUIDATION_PRECISION = 100;
    uint256 internal constant LIQUIDATION_BONUS = 10;
    uint256 internal constant MIN_HEALTH_FACTOR = 1e18;

    int256 internal constant INITIAL_WETH_PRICE = 2_000e8;
    int256 internal constant INITIAL_WBTC_PRICE = 1_000e8;
    uint8 internal constant FEED_DECIMALS = 8;

    DecentralizedStableCoin internal dsc;
    DSCEngine internal engine;
    MockV3Aggregator internal wethFeed;
    MockV3Aggregator internal wbtcFeed;
    ERC20Mock internal weth;
    ERC20Mock internal wbtc;

    function _deploySystem(int256 wethPrice, int256 wbtcPrice) internal {
        dsc = new DecentralizedStableCoin();
        wethFeed = new MockV3Aggregator(FEED_DECIMALS, wethPrice);
        wbtcFeed = new MockV3Aggregator(FEED_DECIMALS, wbtcPrice);
        weth = new ERC20Mock("Wrapped Ether", "WETH", address(this), 0);
        wbtc = new ERC20Mock("Wrapped Bitcoin", "WBTC", address(this), 0);

        address[] memory tokenAddresses = new address[](2);
        tokenAddresses[0] = address(weth);
        tokenAddresses[1] = address(wbtc);

        address[] memory priceFeedAddresses = new address[](2);
        priceFeedAddresses[0] = address(wethFeed);
        priceFeedAddresses[1] = address(wbtcFeed);

        engine = new DSCEngine(tokenAddresses, priceFeedAddresses, address(dsc));
        dsc.transferOwnership(address(engine));
    }

    function _openPosition(address user, address token, uint256 collateralAmount, uint256 dscAmount) internal {
        ERC20Mock(token).mint(user, collateralAmount);

        vm.startPrank(user);
        IERC20(token).approve(address(engine), type(uint256).max);
        dsc.approve(address(engine), type(uint256).max);
        engine.depositCollateralAndMintDsc(token, collateralAmount, dscAmount);
        vm.stopPrank();
    }

    function _expectedHealthFactor(uint256 totalDscMinted, uint256 collateralValueInUsd)
        internal
        pure
        returns (uint256)
    {
        if (totalDscMinted == 0) return type(uint256).max;

        uint256 collateralAdjustedForThreshold = (collateralValueInUsd * LIQUIDATION_THRESHOLD) / LIQUIDATION_PRECISION;
        return (collateralAdjustedForThreshold * PRECISION) / totalDscMinted;
    }
}

/**
 * @title InvariantTest
 * @notice Stateful invariant tests over the DSC engine, driven by `Handler`.
 *
 * Invariants are split in two groups:
 * 1. Price independent accounting: DSC supply vs recorded debt, engine collateral vs recorded
 *    deposits, engine never holding DSC, ownership wiring.
 * 2. Solvency: health factors can only fall when prices move against the user, and never by
 *    more than that price move.
 */
contract InvariantTest is DSCSystem {
    /// @dev Absorbs 1 wei rounding differences between the engine and the test math.
    uint256 private constant HEALTH_FACTOR_TOLERANCE = 1e6;

    Handler internal handler;

    function setUp() public {
        _deploySystem(INITIAL_WETH_PRICE, INITIAL_WBTC_PRICE);
        handler = new Handler(engine);

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = Handler.depositCollateral.selector;
        selectors[1] = Handler.depositCollateralAndMintDsc.selector;
        selectors[2] = Handler.mintDsc.selector;
        selectors[3] = Handler.redeemCollateral.selector;
        selectors[4] = Handler.burnDsc.selector;
        selectors[5] = Handler.redeemCollateralForDsc.selector;
        selectors[6] = Handler.liquidate.selector;
        selectors[7] = Handler.setPrice.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    ////////////////////////////////////////
    // Conservation & accounting          //
    ////////////////////////////////////////

    /// @notice Every DSC in existence is backed by exactly one unit of recorded debt.
    function invariant_dscSupplyEqualsTotalDebt() public view {
        uint256 totalDebt;

        address[] memory actors = handler.getActors();
        for (uint256 i = 0; i < actors.length; i++) {
            (uint256 debt,) = engine.getAccountInformation(actors[i]);
            totalDebt += debt;
        }

        assertEq(dsc.totalSupply(), totalDebt, "DSC supply != sum of user debts");
    }

    /// @notice The engine holds exactly the collateral it owes to its users, per token.
    function invariant_engineCollateralBalancesMatchRecordedDeposits() public view {
        address[] memory tokens = handler.getTokens();
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 trackedDeposits;

            for (uint256 j = 0; j < actors.length; j++) {
                trackedDeposits += handler.ghost_actorDeposited(actors[j], tokens[i]);
            }

            assertEq(trackedDeposits, handler.ghost_totalDeposited(tokens[i]), "ghost deposit totals diverged");
            assertEq(
                IERC20(tokens[i]).balanceOf(address(engine)), trackedDeposits, "engine collateral != recorded deposits"
            );
        }
    }

    /// @notice Per-account values and health factors match the recorded deposits and the documented formula.
    function invariant_accountInformationMatchesRecordedDeposits() public view {
        address[] memory tokens = handler.getTokens();
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];
            (uint256 debt, uint256 collateralValue) = engine.getAccountInformation(actor);

            uint256 expectedCollateralValue;
            for (uint256 j = 0; j < tokens.length; j++) {
                expectedCollateralValue += engine.getUsdValue(tokens[j], handler.ghost_actorDeposited(actor, tokens[j]));
            }

            assertEq(collateralValue, expectedCollateralValue, "account value != recorded deposits");
            assertEq(
                engine.getHealthFactorFor(actor),
                _expectedHealthFactor(debt, collateralValue),
                "health factor formula drift"
            );

            if (debt > 0) assertGt(collateralValue, 0, "debt without collateral");
        }
    }

    /// @notice The engine never keeps DSC: everything it receives gets burned.
    function invariant_engineHoldsNoDsc() public view {
        assertEq(dsc.balanceOf(address(engine)), 0, "engine is holding DSC");
    }

    /// @notice The engine is the only minter and burner of DSC.
    function invariant_engineOwnsDsc() public view {
        assertEq(dsc.owner(), address(engine), "engine does not own DSC");
    }

    ////////////////////////////////////////
    // Solvency                           //
    ////////////////////////////////////////

    /// @notice A user's health factor can only fall when prices move against it.
    /// @dev Health factor is linear in collateral prices, so between two user actions:
    ///      HF_now >= HF_snapshot * min(price_now / price_snapshot).
    ///      Therefore no action sequence can push a user underwater without a price drop.
    function invariant_healthFactorOnlyFallsWithPrice() public view {
        address[] memory tokens = handler.getTokens();
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];

            uint256 snapshotHealthFactor = handler.ghost_healthFactorSnapshot(actor);
            if (snapshotHealthFactor == type(uint256).max) continue; // no debt at snapshot time

            uint256 currentHealthFactor = engine.getHealthFactorFor(actor);
            if (currentHealthFactor == type(uint256).max) continue; // debt repaid since

            (uint256 debt,) = engine.getAccountInformation(actor);

            uint256 minPriceRatio = PRECISION;
            for (uint256 j = 0; j < tokens.length; j++) {
                if (handler.ghost_actorDeposited(actor, tokens[j]) == 0) continue;

                uint256 snapshotPrice = handler.ghost_priceSnapshot(actor, tokens[j]);
                uint256 priceRatio = (handler.priceOf(tokens[j]) * PRECISION) / snapshotPrice;
                if (priceRatio < minPriceRatio) minPriceRatio = priceRatio;
            }

            uint256 lowerBound = (snapshotHealthFactor * minPriceRatio) / PRECISION;

            // `getUsdValue` floors every token value to 1 wei of USD, so dust sized positions can
            // shift the health factor by up to `PRECISION / debt` per floored wei. Allow for that
            // plus a 1e-9 relative slack for the price ratio flooring.
            uint256 tolerance = (PRECISION / debt) * 4 + (lowerBound / 1e9) + HEALTH_FACTOR_TOLERANCE;

            assertGe(currentHealthFactor + tolerance, lowerBound, "health factor dropped further than prices did");
        }
    }

    /// @notice Liquidations always improve the liquidated user's health factor.
    function invariant_liquidationsImproveHealthFactor() public view {
        assertEq(handler.ghost_liquidationHealthFactorDecreases(), 0, "liquidation worsened health factor");
    }
}

/**
 * @title StatefulLiquidationTest
 * @notice Fuzzed liquidation flows against a deliberately underwater position, so the
 *         liquidation path is always exercised (not left to the invariant fuzzer's chance).
 */
contract StatefulLiquidationTest is DSCSystem {
    address internal constant USER = address(0xA11CE);
    address internal constant LIQUIDATOR = address(0xB0B);

    uint256 internal constant USER_COLLATERAL = 10 ether;
    uint256 internal constant USER_DEBT = 10_000 ether;
    uint256 internal constant LIQUIDATOR_COLLATERAL = 20 ether;
    uint256 internal constant LIQUIDATOR_DEBT = 10_000 ether;

    function setUp() public {
        _deploySystem(INITIAL_WETH_PRICE, INITIAL_WBTC_PRICE);

        _openPosition(USER, address(weth), USER_COLLATERAL, USER_DEBT);
        _openPosition(LIQUIDATOR, address(weth), LIQUIDATOR_COLLATERAL, LIQUIDATOR_DEBT);

        // 25% price drop: USER is now at a 0.75 health factor and liquidatable.
        wethFeed.updateAnswer(1_500e8);
    }

    function testFuzz_liquidateConservesValueAndPaysBonus(uint256 debtToCover) public {
        debtToCover = bound(debtToCover, 1 ether, USER_DEBT);

        uint256 supplyBefore = dsc.totalSupply();
        uint256 liquidatorDscBefore = dsc.balanceOf(LIQUIDATOR);
        uint256 liquidatorCollateralBefore = weth.balanceOf(LIQUIDATOR);
        uint256 engineCollateralBefore = weth.balanceOf(address(engine));
        uint256 healthFactorBefore = engine.getHealthFactorFor(USER);

        uint256 tokenAmountFromDebt = engine.getTokenAmountFromUsd(address(weth), debtToCover);
        uint256 expectedCollateralOut =
            tokenAmountFromDebt + (tokenAmountFromDebt * LIQUIDATION_BONUS) / LIQUIDATION_PRECISION;

        vm.prank(LIQUIDATOR);
        engine.liquidate(address(weth), USER, debtToCover);

        (uint256 userDebt,) = engine.getAccountInformation(USER);

        assertEq(userDebt, USER_DEBT - debtToCover, "user debt not reduced");
        assertEq(dsc.totalSupply(), supplyBefore - debtToCover, "DSC not burned");
        assertEq(dsc.balanceOf(LIQUIDATOR), liquidatorDscBefore - debtToCover, "liquidator DSC not spent");
        assertEq(weth.balanceOf(LIQUIDATOR), liquidatorCollateralBefore + expectedCollateralOut, "bonus not paid");
        assertEq(
            weth.balanceOf(address(engine)), engineCollateralBefore - expectedCollateralOut, "engine collateral leak"
        );

        assertGt(engine.getHealthFactorFor(USER), healthFactorBefore, "health factor not improved");
        assertGe(engine.getHealthFactorFor(LIQUIDATOR), MIN_HEALTH_FACTOR, "liquidator became unhealthy");
    }

    /// @notice A liquidation must never be able to destroy more DSC than the user owes.
    function testFuzz_liquidateRevertsAboveUserDebt(uint256 debtToCover) public {
        debtToCover = bound(debtToCover, USER_DEBT + 1, type(uint256).max / 2);

        vm.prank(LIQUIDATOR);
        vm.expectRevert(stdError.arithmeticError);
        engine.liquidate(address(weth), USER, debtToCover);
    }

    /// @notice A healthy position can never be liquidated.
    function testFuzz_liquidateRevertsWhenHealthFactorOk(uint256 price) public {
        price = bound(price, 2_000e8, 4_000e8);
        wethFeed.updateAnswer(int256(price));

        vm.prank(LIQUIDATOR);
        vm.expectRevert(DSCEngine.DSCEngine__HealthFactorOk.selector);
        engine.liquidate(address(weth), USER, 1 ether);
    }
}

/**
 * @title StatefulMintRedeemTest
 * @notice Fuzzed mint/redeem/burn boundaries on a healthy position.
 */
contract StatefulMintRedeemTest is DSCSystem {
    address internal constant USER = address(0xA11CE);

    uint256 internal constant COLLATERAL = 10 ether;
    uint256 internal constant COLLATERAL_VALUE = 20_000 ether;
    uint256 internal constant DEBT = 5_000 ether;
    /// @dev collateralValue - 2 * debt, converted at 2000 USD per WETH: 20_000 - 10_000 = 10_000 USD = 5 WETH
    uint256 internal constant MAX_REDEEM = 5 ether;
    /// @dev adjustedCollateralValue - debt: 10_000 - 5_000 = 5_000 DSC
    uint256 internal constant MAX_ADDITIONAL_DSC = 5_000 ether;

    function setUp() public {
        _deploySystem(INITIAL_WETH_PRICE, INITIAL_WBTC_PRICE);
        _openPosition(USER, address(weth), COLLATERAL, DEBT);
    }

    function testFuzz_redeemCollateralRespectsHealthFactor(uint256 amount) public {
        amount = bound(amount, 1, COLLATERAL);

        if (amount > MAX_REDEEM) {
            uint256 collateralValueAfter = COLLATERAL_VALUE - engine.getUsdValue(address(weth), amount);
            uint256 expectedHealthFactor = _expectedHealthFactor(DEBT, collateralValueAfter);

            vm.prank(USER);
            vm.expectRevert(
                abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, expectedHealthFactor)
            );
            engine.redeemCollateral(address(weth), amount);
        } else {
            vm.prank(USER);
            engine.redeemCollateral(address(weth), amount);

            assertGe(engine.getHealthFactorFor(USER), MIN_HEALTH_FACTOR, "redeem broke health factor");
            assertEq(weth.balanceOf(USER), amount, "collateral not returned");
        }
    }

    function testFuzz_mintDscRespectsHealthFactor(uint256 amount) public {
        amount = bound(amount, 1, 20_000 ether);

        if (amount > MAX_ADDITIONAL_DSC) {
            uint256 expectedHealthFactor = _expectedHealthFactor(DEBT + amount, COLLATERAL_VALUE);

            vm.prank(USER);
            vm.expectRevert(
                abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, expectedHealthFactor)
            );
            engine.mintDsc(amount);
        } else {
            vm.prank(USER);
            engine.mintDsc(amount);

            assertGe(engine.getHealthFactorFor(USER), MIN_HEALTH_FACTOR, "mint broke health factor");
            assertEq(dsc.balanceOf(USER), DEBT + amount, "DSC not minted");
        }
    }

    function testFuzz_burnDscNeverExceedsDebt(uint256 amount) public {
        amount = bound(amount, DEBT + 1, 1e30);

        vm.prank(USER);
        vm.expectRevert(stdError.arithmeticError);
        engine.burnDsc(amount);
    }

    function testFuzz_redeemCollateralAboveDepositReverts(uint256 amount) public {
        amount = bound(amount, COLLATERAL + 1, 1e30);

        vm.prank(USER);
        vm.expectRevert(stdError.arithmeticError);
        engine.redeemCollateral(address(weth), amount);
    }
}

/**
 * @title DSCEngineGetterTest
 * @notice Pins the engine's configuration getters to the values the tests assume.
 */
contract DSCEngineGetterTest is DSCSystem {
    uint256 private constant DEBT_FOR_HEALTH_FACTOR_TEST = 5_000 ether;

    function setUp() public {
        _deploySystem(INITIAL_WETH_PRICE, INITIAL_WBTC_PRICE);
    }

    function test_gettersMatchExpectedConstants() public view {
        assertEq(engine.getPrecision(), PRECISION);
        assertEq(engine.getAdditionalFeedPrecision(), 1e10);
        assertEq(engine.getLiquidationThreshold(), LIQUIDATION_THRESHOLD);
        assertEq(engine.getLiquidationPrecision(), LIQUIDATION_PRECISION);
        assertEq(engine.getLiquidationBonus(), LIQUIDATION_BONUS);
        assertEq(engine.getMinHealthFactor(), MIN_HEALTH_FACTOR);
    }

    function test_gettersExposeWiring() public view {
        assertEq(engine.getDsc(), address(dsc));

        address[] memory collateralTokens = engine.getCollateralTokens();
        assertEq(collateralTokens.length, 2);
        assertEq(collateralTokens[0], address(weth));
        assertEq(collateralTokens[1], address(wbtc));

        assertEq(engine.getCollateralTokenPriceFeed(address(weth)), address(wethFeed));
        assertEq(engine.getCollateralTokenPriceFeed(address(wbtc)), address(wbtcFeed));
        assertEq(engine.getCollateralTokenPriceFeed(address(0xdead)), address(0));
    }

    function test_getHealthFactorForMatchesCallerView() public {
        address user = address(0xA11CE);
        _openPosition(user, address(weth), 10 ether, DEBT_FOR_HEALTH_FACTOR_TEST);

        uint256 expected = _expectedHealthFactor(DEBT_FOR_HEALTH_FACTOR_TEST, 20_000 ether);

        assertEq(engine.getHealthFactorFor(user), expected);
        assertEq(engine.getHealthFactorFor(address(0xBEEF)), type(uint256).max);

        vm.prank(user);
        assertEq(engine.getHealthFactor(), expected);
    }
}
