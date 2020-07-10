// SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "./PodPut.sol";
import "./interfaces/IUniswapV1.sol";
import "./interfaces/WETH.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract wPodPut is PodPut {
    WETH weth;

    constructor(
        string memory _name,
        string memory _symbol,
        OptionCore.OptionType _optionType,
        address _underlyingAsset,
        address _strikeAsset,
        uint256 _strikePrice,
        uint256 _expirationBlockNumber,
        address _uniswapFactory,
        WETH _weth
    )
    public
    PodPut(
        _name,
        _symbol,
        _optionType,
        _underlyingAsset,
        _strikeAsset,
        _strikePrice,
        _expirationBlockNumber,
        _uniswapFactory
    )
    {
        weth = _weth;
    }

    function exchange() external payable beforeExpiration {
        weth.deposit{ value: msg.value }();
        require(
            weth.transfer(msg.sender, msg.value),
            "Could not wrap ETH"
        );
        _internalExchange(msg.value);
    }

    function withdraw() external override afterExpiration {
        uint256 amount = lockedBalance[msg.sender];
        require(amount > 0, "You do not have balance to withdraw");

        // Calculates how many underlying/strike tokens the caller
        // will get back
        uint256 currentStrikeBalance = ERC20(strikeAsset).balanceOf(address(this));
        uint256 strikeToReceive = _strikeToTransfer(amount);
        uint256 underlyingToReceive = 0;
        if (strikeToReceive > currentStrikeBalance) {
            uint256 remainingStrikeAmount = strikeToReceive.sub(currentStrikeBalance);
            strikeToReceive = currentStrikeBalance;

            underlyingToReceive = _underlyingToTransfer(remainingStrikeAmount);
        }

        lockedBalance[msg.sender] = lockedBalance[msg.sender].sub(amount);

        // Unlocks the underlying/strike tokens
        if (strikeToReceive > 0) {
            require(
                ERC20(strikeAsset).transfer(msg.sender, strikeToReceive),
                "Could not transfer back strike tokens to caller"
            );
        }
        if (underlyingToReceive > 0) {
            weth.withdraw(underlyingToReceive);
            Address.sendValue(msg.sender, underlyingToReceive);
        }
        emit Withdraw(msg.sender, amount);
    }
}
