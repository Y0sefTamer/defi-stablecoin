// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20Mock} from "./ERC20Mock.sol";

/**
 * @title ERC20MockFalse
 * @notice ERC20 mock that can return false from transfer and transferFrom without reverting.
 * @dev Used to exercise the DSCEngine transfer-failure paths.
 */
contract ERC20MockFalse is ERC20Mock {
    bool public failTransfer;
    bool public failTransferFrom;

    constructor(string memory name, string memory symbol, address initialAccount, uint256 initialBalance)
        ERC20Mock(name, symbol, initialAccount, initialBalance)
    {}

    function setFailTransfer(bool _failTransfer) external {
        failTransfer = _failTransfer;
    }

    function setFailTransferFrom(bool _failTransferFrom) external {
        failTransferFrom = _failTransferFrom;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (failTransfer) {
            return false;
        }
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (failTransferFrom) {
            return false;
        }
        return super.transferFrom(from, to, value);
    }
}
