// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DecentralizedStableCoin} from "../../src/DecentralizedStableCoin.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DecentralizedStableCoinTest is Test {
    DecentralizedStableCoin public dsc;

    address public constant USER = address(0x1234);
    address public constant ZERO_ADDRESS = address(0);

    function setUp() external {
        dsc = new DecentralizedStableCoin();
    }

    ///////////////////
    // Constructor   //
    ///////////////////
    function testInitialState() public view {
        assertEq(dsc.name(), "DecentralizedStableCoin");
        assertEq(dsc.symbol(), "DSC");
        assertEq(dsc.decimals(), 18);
        assertEq(dsc.totalSupply(), 0);
        assertEq(dsc.owner(), address(this));
    }

    ///////////////////
    // Mint          //
    ///////////////////
    function testMint() public {
        uint256 amount = 1 ether;

        vm.expectEmit(true, true, false, true, address(dsc));
        emit IERC20.Transfer(ZERO_ADDRESS, USER, amount);

        bool minted = dsc.mint(USER, amount);

        assertTrue(minted);
        assertEq(dsc.balanceOf(USER), amount);
        assertEq(dsc.totalSupply(), amount);
    }

    function testMintRevertsWhenAmountIsZero() public {
        vm.expectRevert(DecentralizedStableCoin.DecentralizedStableCoin__AmountMustBeMoreThanZero.selector);
        dsc.mint(USER, 0);
    }

    function testMintRevertsWhenToIsZeroAddress() public {
        vm.expectRevert(DecentralizedStableCoin.DecentralizedStableCoin__NotZeroAddress.selector);
        dsc.mint(ZERO_ADDRESS, 1 ether);
    }

    function testMintRevertsWhenCallerIsNotOwner() public {
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, USER));
        dsc.mint(USER, 1 ether);
    }

    function testFuzzMint(uint256 amount) public {
        amount = bound(amount, 1, 1e30);

        dsc.mint(USER, amount);

        assertEq(dsc.balanceOf(USER), amount);
        assertEq(dsc.totalSupply(), amount);
    }

    ///////////////////
    // Burn          //
    ///////////////////
    function testBurn() public {
        uint256 amount = 1 ether;
        dsc.mint(address(this), amount);

        vm.expectEmit(true, true, false, true, address(dsc));
        emit IERC20.Transfer(address(this), ZERO_ADDRESS, amount);

        dsc.burn(amount);

        assertEq(dsc.balanceOf(address(this)), 0);
        assertEq(dsc.totalSupply(), 0);
    }

    function testBurnRevertsWhenAmountIsZero() public {
        dsc.mint(address(this), 1 ether);

        vm.expectRevert(DecentralizedStableCoin.DecentralizedStableCoin__AmountMustBeMoreThanZero.selector);
        dsc.burn(0);
    }

    function testBurnRevertsWhenAmountExceedsBalance() public {
        dsc.mint(address(this), 1 ether);

        vm.expectRevert(DecentralizedStableCoin.DecentralizedStableCoin__BurnAmountExceedsBalance.selector);
        dsc.burn(2 ether);
    }

    function testBurnRevertsWhenCallerIsNotOwner() public {
        dsc.mint(USER, 1 ether);

        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, USER));
        dsc.burn(1 ether);
    }

    function testFuzzBurn(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        dsc.mint(address(this), amount);

        dsc.burn(amount);

        assertEq(dsc.balanceOf(address(this)), 0);
        assertEq(dsc.totalSupply(), 0);
    }
}
