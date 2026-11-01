// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockDSC
 * @notice Minimal DSC-compatible token whose mint and transferFrom can be forced to fail.
 * @dev DSCEngine stores the DSC address as DecentralizedStableCoin and calls the same selectors,
 * so this mock is only needed to reach the MintFailed and TransferFailed branches.
 */
contract MockDSC is ERC20 {
    bool public failMint;
    bool public failTransferFrom;

    constructor() ERC20("Mock DecentralizedStableCoin", "mDSC") {}

    function setFailMint(bool _failMint) external {
        failMint = _failMint;
    }

    function setFailTransferFrom(bool _failTransferFrom) external {
        failTransferFrom = _failTransferFrom;
    }

    function mint(address _to, uint256 _amount) external returns (bool) {
        if (failMint) {
            return false;
        }
        _mint(_to, _amount);
        return true;
    }

    function burn(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (failTransferFrom) {
            return false;
        }
        return super.transferFrom(from, to, value);
    }
}
