// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {DSCEngine} from "../../src/DSCEngine.sol";
import {DecentralizedStableCoin} from "../../src/DecentralizedStableCoin.sol";
import {ERC20Mock} from "../mocks/ERC20Mock.sol";
import {ERC20MockFalse} from "../mocks/ERC20MockFalse.sol";
import {MockDSC} from "../mocks/MockDSC.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DSCEngineTest is Test {
    DecentralizedStableCoin public dsc;
    DSCEngine public dscEngine;
    MockV3Aggregator public wethUsdPriceFeed;
    MockV3Aggregator public wbtcUsdPriceFeed;
    ERC20Mock public weth;
    ERC20Mock public wbtc;

    address public constant USER = address(0x1234);
    address public constant LIQUIDATOR = address(0x5678);
    address public constant ZERO_ADDRESS = address(0);

    uint256 public constant COLLATERAL_AMOUNT = 10 ether;
    uint256 public constant LIQUIDATOR_COLLATERAL_AMOUNT = 20 ether;
    int256 public constant INITIAL_WETH_PRICE = 2000e8;
    int256 public constant INITIAL_WBTC_PRICE = 1000e8;

    uint256 public constant PRECISION = 1e18;
    uint256 public constant LIQUIDATION_THRESHOLD = 50;
    uint256 public constant LIQUIDATION_PRECISION = 100;
    uint256 public constant MIN_HEALTH_FACTOR = 1e18;
    uint256 public constant LIQUIDATION_BONUS = 10;

    function setUp() public {
        vm.label(USER, "USER");
        vm.label(LIQUIDATOR, "LIQUIDATOR");

        wethUsdPriceFeed = new MockV3Aggregator(8, INITIAL_WETH_PRICE);
        wbtcUsdPriceFeed = new MockV3Aggregator(8, INITIAL_WBTC_PRICE);

        weth = new ERC20Mock("WETH", "WETH", address(this), 1_000 ether);
        wbtc = new ERC20Mock("WBTC", "WBTC", address(this), 1_000 ether);

        dsc = new DecentralizedStableCoin();

        address[] memory tokenAddresses = new address[](2);
        tokenAddresses[0] = address(weth);
        tokenAddresses[1] = address(wbtc);

        address[] memory priceFeedAddresses = new address[](2);
        priceFeedAddresses[0] = address(wethUsdPriceFeed);
        priceFeedAddresses[1] = address(wbtcUsdPriceFeed);

        dscEngine = new DSCEngine(tokenAddresses, priceFeedAddresses, address(dsc));
        dsc.transferOwnership(address(dscEngine));

        weth.mint(USER, COLLATERAL_AMOUNT);
        wbtc.mint(USER, COLLATERAL_AMOUNT);
        weth.mint(LIQUIDATOR, LIQUIDATOR_COLLATERAL_AMOUNT);
        wbtc.mint(LIQUIDATOR, LIQUIDATOR_COLLATERAL_AMOUNT);
    }

    ////////////////////
    // Test Helpers   //
    ////////////////////

    function _deployEngineWithToken(address token, address priceFeed, address dscAddress)
        internal
        returns (DSCEngine engine)
    {
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        address[] memory feeds = new address[](1);
        feeds[0] = priceFeed;
        engine = new DSCEngine(tokens, feeds, dscAddress);
    }

    function _deposit(address user, address token, uint256 amount) internal {
        vm.startPrank(user);
        IERC20(token).approve(address(dscEngine), amount);
        dscEngine.depositCollateral(token, amount);
        vm.stopPrank();
    }

    function _depositAndMint(address user, address token, uint256 collateralAmount, uint256 dscAmount) internal {
        vm.startPrank(user);
        IERC20(token).approve(address(dscEngine), collateralAmount);
        dscEngine.depositCollateralAndMintDsc(token, collateralAmount, dscAmount);
        vm.stopPrank();
    }

    function _healthFactorOf(address user) internal view returns (uint256) {
        (uint256 totalDscMinted, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(user);
        return _expectedHealthFactor(totalDscMinted, collateralValueInUsd);
    }

    function _expectedHealthFactor(uint256 totalDscMinted, uint256 collateralValueInUsd)
        internal
        pure
        returns (uint256)
    {
        if (totalDscMinted == 0) {
            return type(uint256).max;
        }
        uint256 collateralAdjustedForThreshold = (collateralValueInUsd * LIQUIDATION_THRESHOLD) / LIQUIDATION_PRECISION;
        return (collateralAdjustedForThreshold * PRECISION) / totalDscMinted;
    }

    /////////////////////
    // Constructor     //
    /////////////////////

    function testRevertsIfTokenLengthDoesntMatchPriceFeeds() public {
        address[] memory tokenAddresses = new address[](1);
        tokenAddresses[0] = address(weth);
        address[] memory feedAddresses = new address[](2);
        feedAddresses[0] = address(wethUsdPriceFeed);
        feedAddresses[1] = address(wbtcUsdPriceFeed);

        vm.expectRevert(DSCEngine.DSCEngine__TokenAddressesAndPriceFeedAddressesAmountsDontMatch.selector);
        new DSCEngine(tokenAddresses, feedAddresses, address(dsc));
    }

    function testConstructorSetsPriceFeeds() public view {
        assertEq(dscEngine.getUsdValue(address(weth), 1 ether), 2000 ether);
        assertEq(dscEngine.getUsdValue(address(wbtc), 1 ether), 1000 ether);
    }

    //////////////////////////
    // Deposit Collateral   //
    //////////////////////////

    function testDepositCollateralRevertsWithZeroAmount() public {
        vm.startPrank(USER);
        weth.approve(address(dscEngine), COLLATERAL_AMOUNT);
        vm.expectRevert(DSCEngine.DSCEngine__NeedsMoreThanZero.selector);
        dscEngine.depositCollateral(address(weth), 0);
        vm.stopPrank();
    }

    function testDepositCollateralRevertsWithUnapprovedToken() public {
        ERC20Mock randToken = new ERC20Mock("RAN", "RAN", USER, COLLATERAL_AMOUNT);

        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(DSCEngine.DSCEngine__TokenNotAllowed.selector, address(randToken)));
        dscEngine.depositCollateral(address(randToken), COLLATERAL_AMOUNT);
        vm.stopPrank();
    }

    function testDepositCollateral() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        (uint256 totalDscMinted, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 0);
        assertEq(collateralValueInUsd, 20_000 ether);
        assertEq(weth.balanceOf(address(dscEngine)), COLLATERAL_AMOUNT);
        assertEq(weth.balanceOf(USER), 0);
    }

    function testDepositCollateralEmitsEvent() public {
        vm.startPrank(USER);
        weth.approve(address(dscEngine), COLLATERAL_AMOUNT);

        vm.expectEmit(true, true, true, true, address(dscEngine));
        emit DSCEngine.CollateralDeposited(USER, address(weth), COLLATERAL_AMOUNT);

        dscEngine.depositCollateral(address(weth), COLLATERAL_AMOUNT);
        vm.stopPrank();
    }

    function testDepositCollateralAccumulates() public {
        _deposit(USER, address(weth), 4 ether);
        _deposit(USER, address(weth), 6 ether);

        (, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(collateralValueInUsd, 20_000 ether);
        assertEq(weth.balanceOf(address(dscEngine)), COLLATERAL_AMOUNT);
    }

    function testDepositWbtc() public {
        _deposit(USER, address(wbtc), COLLATERAL_AMOUNT);

        (, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(collateralValueInUsd, 10_000 ether);
        assertEq(wbtc.balanceOf(address(dscEngine)), COLLATERAL_AMOUNT);
    }

    function testDepositCollateralRevertsWhenTransferFromReturnsFalse() public {
        ERC20MockFalse badToken = new ERC20MockFalse("BAD", "BAD", USER, COLLATERAL_AMOUNT);
        badToken.setFailTransferFrom(true);
        DSCEngine badEngine = _deployEngineWithToken(address(badToken), address(wethUsdPriceFeed), address(dsc));

        vm.startPrank(USER);
        badToken.approve(address(badEngine), COLLATERAL_AMOUNT);
        vm.expectRevert(DSCEngine.DSCEngine__TransferFailed.selector);
        badEngine.depositCollateral(address(badToken), COLLATERAL_AMOUNT);
        vm.stopPrank();
    }

    function testRedeemCollateralRevertsWhenTransferReturnsFalse() public {
        ERC20MockFalse badToken = new ERC20MockFalse("BAD", "BAD", USER, COLLATERAL_AMOUNT);
        DSCEngine badEngine = _deployEngineWithToken(address(badToken), address(wethUsdPriceFeed), address(dsc));

        vm.startPrank(USER);
        badToken.approve(address(badEngine), COLLATERAL_AMOUNT);
        badEngine.depositCollateral(address(badToken), COLLATERAL_AMOUNT);

        badToken.setFailTransfer(true);
        vm.expectRevert(DSCEngine.DSCEngine__TransferFailed.selector);
        badEngine.redeemCollateral(address(badToken), COLLATERAL_AMOUNT);
        vm.stopPrank();
    }

    function testFuzzDepositCollateral(uint256 amount) public {
        amount = bound(amount, 1, COLLATERAL_AMOUNT);

        _deposit(USER, address(weth), amount);

        (, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(collateralValueInUsd, amount * 2000);
        assertEq(weth.balanceOf(address(dscEngine)), amount);
    }

    //////////////////////////
    // Mint DSC              //
    //////////////////////////

    function testMintDscRevertsWithZeroAmount() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.startPrank(USER);
        vm.expectRevert(DSCEngine.DSCEngine__NeedsMoreThanZero.selector);
        dscEngine.mintDsc(0);
        vm.stopPrank();
    }

    function testMintDscRevertsWithNoCollateral() public {
        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, uint256(0)));
        dscEngine.mintDsc(1 ether);
        vm.stopPrank();
    }

    function testMintDsc() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.prank(USER);
        dscEngine.mintDsc(1000 ether);

        (uint256 totalDscMinted,) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 1000 ether);
        assertEq(dsc.balanceOf(USER), 1000 ether);
        assertEq(dsc.totalSupply(), 1000 ether);
        assertEq(_healthFactorOf(USER), 10 ether);
    }

    function testMintDscAtExactHealthFactorBoundary() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.prank(USER);
        dscEngine.mintDsc(10_000 ether);

        vm.prank(USER);
        assertEq(dscEngine.getHealthFactor(), MIN_HEALTH_FACTOR);

        uint256 expectedHealthFactor = _expectedHealthFactor(10_000 ether + 1, 20_000 ether);
        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, expectedHealthFactor));
        dscEngine.mintDsc(1);
        vm.stopPrank();
    }

    function testMintDscRevertsIfHealthFactorBreaks() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        uint256 expectedHealthFactor = _expectedHealthFactor(10_001 ether, 20_000 ether);

        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, expectedHealthFactor));
        dscEngine.mintDsc(10_001 ether);
        vm.stopPrank();
    }

    function testMintDscRevertsWhenMintReturnsFalse() public {
        MockDSC mockDsc = new MockDSC();
        DSCEngine mockEngine = _deployEngineWithToken(address(weth), address(wethUsdPriceFeed), address(mockDsc));

        vm.startPrank(USER);
        weth.approve(address(mockEngine), COLLATERAL_AMOUNT);
        mockEngine.depositCollateral(address(weth), COLLATERAL_AMOUNT);

        mockDsc.setFailMint(true);
        vm.expectRevert(DSCEngine.DSCEngine__MintFailed.selector);
        mockEngine.mintDsc(1 ether);
        vm.stopPrank();
    }

    function testFuzzMintDsc(uint256 amount) public {
        amount = bound(amount, 1, 10_000 ether);
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.prank(USER);
        dscEngine.mintDsc(amount);

        (uint256 totalDscMinted,) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, amount);
        assertEq(dsc.balanceOf(USER), amount);
        assertGe(_healthFactorOf(USER), MIN_HEALTH_FACTOR);
    }

    //////////////////////////
    // View / Price Tests   //
    //////////////////////////

    function testGetUsdValue() public view {
        uint256 ethAmount = 15 ether;
        uint256 expectedUsd = 30_000 ether;
        uint256 actualUsd = dscEngine.getUsdValue(address(weth), ethAmount);

        assertEq(actualUsd, expectedUsd, "USD value calculation is incorrect");
    }

    function testGetUsdValueWbtc() public view {
        uint256 btcAmount = 15 ether;
        uint256 expectedUsd = 15_000 ether;
        uint256 actualUsd = dscEngine.getUsdValue(address(wbtc), btcAmount);

        assertEq(actualUsd, expectedUsd, "WBTC USD value calculation is incorrect");
    }

    function testGetUsdValueZeroAmount() public view {
        assertEq(dscEngine.getUsdValue(address(weth), 0), 0);
    }

    function testGetUsdValueRevertsForUnknownToken() public {
        vm.expectRevert();
        dscEngine.getUsdValue(address(0xdead), 1 ether);
    }

    function testGetTokenAmountFromUsd() public view {
        uint256 usdAmount = 100 ether;
        uint256 expectedWeth = 0.05 ether;
        uint256 amountWeth = dscEngine.getTokenAmountFromUsd(address(weth), usdAmount);

        assertEq(amountWeth, expectedWeth);
    }

    function testGetTokenAmountFromUsdWbtc() public view {
        uint256 usdAmount = 100 ether;
        uint256 expectedWbtc = 0.1 ether;
        uint256 amountWbtc = dscEngine.getTokenAmountFromUsd(address(wbtc), usdAmount);

        assertEq(amountWbtc, expectedWbtc);
    }

    function testGetTokenAmountFromUsdZero() public view {
        assertEq(dscEngine.getTokenAmountFromUsd(address(weth), 0), 0);
    }

    function testGetTokenAmountFromUsdRevertsForUnknownToken() public {
        vm.expectRevert();
        dscEngine.getTokenAmountFromUsd(address(0xdead), 1 ether);
    }

    function testGetAccountCollateralValue() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);
        _deposit(USER, address(wbtc), COLLATERAL_AMOUNT);

        uint256 collateralValue = dscEngine.getAccountCollateralValue(USER);

        assertEq(collateralValue, 30_000 ether);
    }

    function testGetAccountInformationEmpty() public view {
        (uint256 totalDscMinted, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 0);
        assertEq(collateralValueInUsd, 0);
    }

    function testGetHealthFactorNoDebt() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.prank(USER);
        assertEq(dscEngine.getHealthFactor(), type(uint256).max);
    }

    function testGetHealthFactorWithDebt() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 5000 ether);

        vm.prank(USER);
        assertEq(dscEngine.getHealthFactor(), 2 ether);
    }

    function testGetHealthFactorAfterPriceDrop() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 10_000 ether);
        wethUsdPriceFeed.updateAnswer(1500e8);

        vm.prank(USER);
        assertEq(dscEngine.getHealthFactor(), 0.75 ether);
    }

    function testFuzzGetUsdValue(uint256 amount) public view {
        amount = bound(amount, 0, 1e24);

        assertEq(dscEngine.getUsdValue(address(weth), amount), amount * 2000);
    }

    function testFuzzGetTokenAmountFromUsd(uint256 usdAmount) public view {
        usdAmount = bound(usdAmount, 0, 1e30);

        assertEq(dscEngine.getTokenAmountFromUsd(address(weth), usdAmount), usdAmount / 2000);
    }

    //////////////////////////
    // Redeem Collateral    //
    //////////////////////////

    function testRedeemCollateralRevertsWithZeroAmount() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.startPrank(USER);
        vm.expectRevert(DSCEngine.DSCEngine__NeedsMoreThanZero.selector);
        dscEngine.redeemCollateral(address(weth), 0);
        vm.stopPrank();
    }

    function testRedeemCollateralWithoutDebt() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.prank(USER);
        dscEngine.redeemCollateral(address(weth), 5 ether);

        (, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(collateralValueInUsd, 10_000 ether);
        assertEq(weth.balanceOf(USER), 5 ether);
        assertEq(weth.balanceOf(address(dscEngine)), 5 ether);
    }

    function testRedeemCollateralWithDebt() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 5000 ether);

        vm.prank(USER);
        dscEngine.redeemCollateral(address(weth), 5 ether);

        (, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(collateralValueInUsd, 10_000 ether);
        assertEq(weth.balanceOf(USER), 5 ether);
        assertEq(_healthFactorOf(USER), 1 ether);
    }

    function testRedeemCollateralEmitsEvent() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.startPrank(USER);
        vm.expectEmit(true, true, true, true, address(dscEngine));
        emit DSCEngine.CollateralRedeemed(USER, USER, address(weth), 5 ether);
        dscEngine.redeemCollateral(address(weth), 5 ether);
        vm.stopPrank();
    }

    function testRedeemCollateralRevertsIfAmountExceedsDeposit() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.startPrank(USER);
        vm.expectRevert(stdError.arithmeticError);
        dscEngine.redeemCollateral(address(weth), COLLATERAL_AMOUNT + 1);
        vm.stopPrank();
    }

    function testRedeemCollateralRevertsIfHealthFactorBreaks() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 9000 ether);

        uint256 expectedHealthFactor = _expectedHealthFactor(9000 ether, 16_000 ether);

        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, expectedHealthFactor));
        dscEngine.redeemCollateral(address(weth), 2 ether);
        vm.stopPrank();
    }

    function testFuzzRedeemCollateral(uint256 amount) public {
        amount = bound(amount, 1, 5 ether);
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 5000 ether);

        vm.prank(USER);
        dscEngine.redeemCollateral(address(weth), amount);

        (, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(collateralValueInUsd, (COLLATERAL_AMOUNT - amount) * 2000);
        assertEq(weth.balanceOf(USER), amount);
        assertGe(_healthFactorOf(USER), MIN_HEALTH_FACTOR);
    }

    //////////////////////////
    // Burn DSC             //
    //////////////////////////

    function testBurnDscRevertsWithZeroAmount() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 1000 ether);

        vm.startPrank(USER);
        vm.expectRevert(DSCEngine.DSCEngine__NeedsMoreThanZero.selector);
        dscEngine.burnDsc(0);
        vm.stopPrank();
    }

    function testBurnDsc() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 10_000 ether);

        vm.startPrank(USER);
        dsc.approve(address(dscEngine), 5000 ether);
        dscEngine.burnDsc(5000 ether);
        vm.stopPrank();

        (uint256 totalDscMinted,) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 5000 ether);
        assertEq(dsc.balanceOf(USER), 5000 ether);
        assertEq(dsc.totalSupply(), 5000 ether);
        assertEq(_healthFactorOf(USER), 2 ether);
    }

    function testBurnDscFullDebt() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 10_000 ether);

        vm.startPrank(USER);
        dsc.approve(address(dscEngine), 10_000 ether);
        dscEngine.burnDsc(10_000 ether);
        vm.stopPrank();

        (uint256 totalDscMinted,) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 0);
        assertEq(dsc.balanceOf(USER), 0);
        assertEq(dsc.totalSupply(), 0);
        assertEq(_healthFactorOf(USER), type(uint256).max);
    }

    function testBurnDscRevertsWhenTransferFromReturnsFalse() public {
        MockDSC mockDsc = new MockDSC();
        DSCEngine mockEngine = _deployEngineWithToken(address(weth), address(wethUsdPriceFeed), address(mockDsc));

        vm.startPrank(USER);
        weth.approve(address(mockEngine), COLLATERAL_AMOUNT);
        mockEngine.depositCollateralAndMintDsc(address(weth), COLLATERAL_AMOUNT, 1000 ether);

        mockDsc.setFailTransferFrom(true);
        vm.expectRevert(DSCEngine.DSCEngine__TransferFailed.selector);
        mockEngine.burnDsc(500 ether);
        vm.stopPrank();
    }

    function testBurnDscRevertsWhenAmountExceedsMinted() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 1000 ether);

        vm.startPrank(USER);
        vm.expectRevert(stdError.arithmeticError);
        dscEngine.burnDsc(1001 ether);
        vm.stopPrank();
    }

    function testFuzzBurnDsc(uint256 amount) public {
        amount = bound(amount, 1, 10_000 ether);
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 10_000 ether);

        vm.startPrank(USER);
        dsc.approve(address(dscEngine), amount);
        dscEngine.burnDsc(amount);
        vm.stopPrank();

        (uint256 totalDscMinted,) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 10_000 ether - amount);
        assertEq(dsc.balanceOf(USER), 10_000 ether - amount);
        assertGe(_healthFactorOf(USER), MIN_HEALTH_FACTOR);
    }

    //////////////////////////
    // Combined Functions   //
    //////////////////////////

    function testDepositCollateralAndMintDsc() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 5000 ether);

        (uint256 totalDscMinted, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 5000 ether);
        assertEq(collateralValueInUsd, 20_000 ether);
        assertEq(dsc.balanceOf(USER), 5000 ether);
        assertEq(weth.balanceOf(address(dscEngine)), COLLATERAL_AMOUNT);
    }

    function testDepositCollateralAndMintDscRevertsOnZeroCollateral() public {
        vm.startPrank(USER);
        weth.approve(address(dscEngine), COLLATERAL_AMOUNT);
        vm.expectRevert(DSCEngine.DSCEngine__NeedsMoreThanZero.selector);
        dscEngine.depositCollateralAndMintDsc(address(weth), 0, 1000 ether);
        vm.stopPrank();
    }

    function testDepositCollateralAndMintDscRevertsOnZeroMint() public {
        vm.startPrank(USER);
        weth.approve(address(dscEngine), COLLATERAL_AMOUNT);
        vm.expectRevert(DSCEngine.DSCEngine__NeedsMoreThanZero.selector);
        dscEngine.depositCollateralAndMintDsc(address(weth), COLLATERAL_AMOUNT, 0);
        vm.stopPrank();

        (uint256 totalDscMinted, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);
        assertEq(totalDscMinted, 0);
        assertEq(collateralValueInUsd, 0);
    }

    function testRedeemCollateralForDsc() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 5000 ether);

        vm.startPrank(USER);
        dsc.approve(address(dscEngine), 2000 ether);
        dscEngine.redeemCollateralForDsc(address(weth), 2 ether, 2000 ether);
        vm.stopPrank();

        (uint256 totalDscMinted, uint256 collateralValueInUsd) = dscEngine.getAccountInformation(USER);

        assertEq(totalDscMinted, 3000 ether);
        assertEq(collateralValueInUsd, 16_000 ether);
        assertEq(dsc.balanceOf(USER), 3000 ether);
        assertEq(weth.balanceOf(USER), 2 ether);
    }

    function testRedeemCollateralForDscRevertsWhenBurnExceedsDebt() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 5000 ether);

        vm.startPrank(USER);
        vm.expectRevert(stdError.arithmeticError);
        dscEngine.redeemCollateralForDsc(address(weth), 1 ether, 5001 ether);
        vm.stopPrank();
    }

    function testRedeemCollateralForDscRevertsIfHealthFactorBreaks() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 9000 ether);

        uint256 expectedHealthFactor = _expectedHealthFactor(8900 ether, 16_000 ether);

        vm.startPrank(USER);
        dsc.approve(address(dscEngine), 100 ether);
        vm.expectRevert(abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, expectedHealthFactor));
        dscEngine.redeemCollateralForDsc(address(weth), 2 ether, 100 ether);
        vm.stopPrank();
    }

    //////////////////////////
    // Liquidation          //
    //////////////////////////

    function _setUpUserForLiquidation() internal {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 10_000 ether);
    }

    function _setUpLiquidator(uint256 collateralAmount, uint256 dscAmount) internal {
        _depositAndMint(LIQUIDATOR, address(weth), collateralAmount, dscAmount);
    }

    function testLiquidateRevertsWithZeroDebt() public {
        _setUpUserForLiquidation();

        vm.startPrank(LIQUIDATOR);
        vm.expectRevert(DSCEngine.DSCEngine__NeedsMoreThanZero.selector);
        dscEngine.liquidate(address(weth), USER, 0);
        vm.stopPrank();
    }

    function testLiquidateRevertsWhenUserHealthFactorIsOk() public {
        _depositAndMint(USER, address(weth), COLLATERAL_AMOUNT, 1000 ether);

        vm.startPrank(LIQUIDATOR);
        vm.expectRevert(DSCEngine.DSCEngine__HealthFactorOk.selector);
        dscEngine.liquidate(address(weth), USER, 1 ether);
        vm.stopPrank();
    }

    function testLiquidateRevertsWhenUserHasNoDebt() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.startPrank(LIQUIDATOR);
        vm.expectRevert(DSCEngine.DSCEngine__HealthFactorOk.selector);
        dscEngine.liquidate(address(weth), USER, 1 ether);
        vm.stopPrank();
    }

    function testLiquidatePartial() public {
        _setUpUserForLiquidation();
        _setUpLiquidator(LIQUIDATOR_COLLATERAL_AMOUNT, 10_000 ether);

        wethUsdPriceFeed.updateAnswer(1500e8);

        uint256 debtToCover = 1000 ether;
        uint256 tokenAmountFromDebtCovered = dscEngine.getTokenAmountFromUsd(address(weth), debtToCover);
        uint256 bonusCollateral = (tokenAmountFromDebtCovered * LIQUIDATION_BONUS) / LIQUIDATION_PRECISION;
        uint256 totalCollateralToRedeem = tokenAmountFromDebtCovered + bonusCollateral;

        uint256 userHealthFactorBefore = _healthFactorOf(USER);
        uint256 engineWethBefore = weth.balanceOf(address(dscEngine));
        uint256 liquidatorDscBefore = dsc.balanceOf(LIQUIDATOR);
        uint256 totalSupplyBefore = dsc.totalSupply();

        vm.startPrank(LIQUIDATOR);
        dsc.approve(address(dscEngine), debtToCover);

        vm.expectEmit(true, true, true, true, address(dscEngine));
        emit DSCEngine.CollateralRedeemed(USER, LIQUIDATOR, address(weth), totalCollateralToRedeem);

        dscEngine.liquidate(address(weth), USER, debtToCover);
        vm.stopPrank();

        (uint256 userDscMinted,) = dscEngine.getAccountInformation(USER);

        assertEq(userDscMinted, 9000 ether);
        assertEq(weth.balanceOf(address(dscEngine)), engineWethBefore - totalCollateralToRedeem);
        assertEq(weth.balanceOf(LIQUIDATOR), totalCollateralToRedeem);
        assertEq(dsc.balanceOf(LIQUIDATOR), liquidatorDscBefore - debtToCover);
        assertEq(dsc.totalSupply(), totalSupplyBefore - debtToCover);
        assertGt(_healthFactorOf(USER), userHealthFactorBefore);
        assertGe(_healthFactorOf(LIQUIDATOR), MIN_HEALTH_FACTOR);
    }

    function testLiquidateFull() public {
        _setUpUserForLiquidation();
        _setUpLiquidator(LIQUIDATOR_COLLATERAL_AMOUNT, 10_000 ether);

        wethUsdPriceFeed.updateAnswer(1500e8);

        uint256 debtToCover = 10_000 ether;
        uint256 tokenAmountFromDebtCovered = dscEngine.getTokenAmountFromUsd(address(weth), debtToCover);
        uint256 totalCollateralToRedeem =
            tokenAmountFromDebtCovered + (tokenAmountFromDebtCovered * LIQUIDATION_BONUS) / LIQUIDATION_PRECISION;

        uint256 engineWethBefore = weth.balanceOf(address(dscEngine));

        vm.startPrank(LIQUIDATOR);
        dsc.approve(address(dscEngine), debtToCover);
        dscEngine.liquidate(address(weth), USER, debtToCover);
        vm.stopPrank();

        (uint256 userDscMinted,) = dscEngine.getAccountInformation(USER);

        assertEq(userDscMinted, 0);
        assertEq(_healthFactorOf(USER), type(uint256).max);
        assertEq(weth.balanceOf(address(dscEngine)), engineWethBefore - totalCollateralToRedeem);
        assertEq(weth.balanceOf(LIQUIDATOR), totalCollateralToRedeem);
        assertEq(dsc.balanceOf(LIQUIDATOR), 0);
    }

    function testLiquidateRevertsWhenHealthFactorNotImproved() public {
        _setUpUserForLiquidation();
        _setUpLiquidator(LIQUIDATOR_COLLATERAL_AMOUNT, 10_000 ether);

        wethUsdPriceFeed.updateAnswer(1000e8);

        uint256 debtToCover = 1000 ether;

        vm.startPrank(LIQUIDATOR);
        dsc.approve(address(dscEngine), debtToCover);
        vm.expectRevert(DSCEngine.DSCEngine__HealthFactorNotImproved.selector);
        dscEngine.liquidate(address(weth), USER, debtToCover);
        vm.stopPrank();
    }

    function testLiquidateRevertsWhenLiquidatorHealthFactorBreaks() public {
        _setUpUserForLiquidation();
        _setUpLiquidator(COLLATERAL_AMOUNT, 10_000 ether);

        wethUsdPriceFeed.updateAnswer(1200e8);

        uint256 debtToCover = 1000 ether;
        uint256 expectedLiquidatorHealthFactor = _healthFactorOf(LIQUIDATOR);

        vm.startPrank(LIQUIDATOR);
        dsc.approve(address(dscEngine), debtToCover);
        vm.expectRevert(
            abi.encodeWithSelector(DSCEngine.DSCEngine__BreaksHealthFactor.selector, expectedLiquidatorHealthFactor)
        );
        dscEngine.liquidate(address(weth), USER, debtToCover);
        vm.stopPrank();
    }

    function testLiquidateRevertsWhenDebtExceedsMinted() public {
        _setUpUserForLiquidation();
        _setUpLiquidator(LIQUIDATOR_COLLATERAL_AMOUNT, 10_000 ether);

        wethUsdPriceFeed.updateAnswer(1500e8);

        vm.startPrank(LIQUIDATOR);
        dsc.approve(address(dscEngine), 10_000 ether);
        vm.expectRevert(stdError.arithmeticError);
        dscEngine.liquidate(address(weth), USER, 10_001 ether);
        vm.stopPrank();
    }

    //////////////////////////////
    // Collateral balance reads //
    //////////////////////////////

    function testGetCollateralBalanceOfIsZeroForFreshAccount() public view {
        assertEq(dscEngine.getCollateralBalanceOf(USER, address(weth)), 0);
        assertEq(dscEngine.getCollateralBalanceOf(USER, address(wbtc)), 0);
    }

    function testGetCollateralBalanceOfTracksDepositsPerToken() public {
        weth.mint(USER, 1 ether);

        _deposit(USER, address(weth), COLLATERAL_AMOUNT);
        _deposit(USER, address(weth), 1 ether);
        _deposit(USER, address(wbtc), 2 ether);

        assertEq(dscEngine.getCollateralBalanceOf(USER, address(weth)), COLLATERAL_AMOUNT + 1 ether);
        assertEq(dscEngine.getCollateralBalanceOf(USER, address(wbtc)), 2 ether);
    }

    function testGetCollateralBalanceOfTracksRedeems() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);

        vm.prank(USER);
        dscEngine.redeemCollateral(address(weth), 4 ether);

        assertEq(dscEngine.getCollateralBalanceOf(USER, address(weth)), COLLATERAL_AMOUNT - 4 ether);
    }

    function testGetCollateralBalanceOfIsPerUser() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);
        _deposit(LIQUIDATOR, address(weth), 3 ether);

        assertEq(dscEngine.getCollateralBalanceOf(USER, address(weth)), COLLATERAL_AMOUNT);
        assertEq(dscEngine.getCollateralBalanceOf(LIQUIDATOR, address(weth)), 3 ether);
    }

    function testGetCollateralBalanceOfIsZeroForUnsupportedToken() public view {
        assertEq(dscEngine.getCollateralBalanceOf(USER, address(0xdead)), 0);
    }

    function testGetCollateralBalancesAlignsWithTokenList() public {
        _deposit(USER, address(weth), COLLATERAL_AMOUNT);
        _deposit(USER, address(wbtc), 3 ether);

        address[] memory tokens = dscEngine.getCollateralTokens();
        uint256[] memory balances = dscEngine.getCollateralBalances(USER);

        assertEq(tokens.length, 2);
        assertEq(balances.length, tokens.length);
        assertEq(balances[0], COLLATERAL_AMOUNT); // weth
        assertEq(balances[1], 3 ether); // wbtc

        for (uint256 i = 0; i < tokens.length; i++) {
            assertEq(balances[i], dscEngine.getCollateralBalanceOf(USER, tokens[i]));
        }
    }

    function testGetCollateralBalancesReturnsZerosForFreshAccount() public view {
        uint256[] memory balances = dscEngine.getCollateralBalances(USER);

        assertEq(balances.length, dscEngine.getCollateralTokens().length);
        for (uint256 i = 0; i < balances.length; i++) {
            assertEq(balances[i], 0);
        }
    }

    function testGetCollateralBalancesReflectsLiquidationSeizure() public {
        _setUpUserForLiquidation();
        _setUpLiquidator(LIQUIDATOR_COLLATERAL_AMOUNT, 10_000 ether);

        wethUsdPriceFeed.updateAnswer(1500e8);

        uint256 debtToCover = 1_000 ether;
        uint256 collateralFromDebt = dscEngine.getTokenAmountFromUsd(address(weth), debtToCover);
        uint256 seizedCollateral = collateralFromDebt + (collateralFromDebt * LIQUIDATION_BONUS) / LIQUIDATION_PRECISION;

        vm.startPrank(LIQUIDATOR);
        dsc.approve(address(dscEngine), debtToCover);
        dscEngine.liquidate(address(weth), USER, debtToCover);
        vm.stopPrank();

        (uint256 userDebt, uint256 userCollateralValue) = dscEngine.getAccountInformation(USER);

        assertEq(userDebt, 10_000 ether - debtToCover);
        assertEq(dscEngine.getCollateralBalanceOf(USER, address(weth)), COLLATERAL_AMOUNT - seizedCollateral);
        assertEq(dscEngine.getUsdValue(address(weth), COLLATERAL_AMOUNT - seizedCollateral), userCollateralValue);
        // The seized collateral goes to the liquidator's wallet, not to its engine balance.
        assertEq(dscEngine.getCollateralBalanceOf(LIQUIDATOR, address(weth)), LIQUIDATOR_COLLATERAL_AMOUNT);
        assertGt(weth.balanceOf(LIQUIDATOR), 0);
    }
}
