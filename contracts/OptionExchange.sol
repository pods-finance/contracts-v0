// SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "@nomiclabs/buidler/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IUniswapV1.sol";
import "./interfaces/IPodPut.sol";

contract OptionExchange {
    IUniswapFactory public uniswapFactory;

    event OptionsBought(
        address indexed buyer,
        address indexed optionAddress,
        uint256 optionsBought,
        address inputToken,
        uint256 inputSold
    );

    event OptionsSold(
        address indexed seller,
        address indexed optionAddress,
        uint256 optionsSold,
        address outputToken,
        uint256 outputBought
    );

    constructor (address _uniswapFactoryAddress) public {
        uniswapFactory = IUniswapFactory(_uniswapFactoryAddress);
    }

    /**
     * Mints an amount of options and sell it in liquidity provider
     * @notice Mint and sell options
     *
     * @param option The option contract to mint
     * @param amount Amount of options to mint
     * @param outputToken The token to which the premium will be paid
     * @param minOutputAmount Minimum amount of output tokens accepted
     * @param deadline The deadline in unix-timestamp that limits the transaction from happening
     */
    function sellOptions(
        IPodPut option,
        uint256 amount,
        address outputToken,
        uint256 minOutputAmount,
        uint256 deadline
    ) external {
        require(deadline > block.timestamp, "Transaction timeout");
        uint256 strikeToTransfer = option.strikeToTransfer(amount);

        IERC20 strikeAsset = IERC20(option.strikeAsset());
        require(
            strikeAsset.transferFrom(msg.sender, address(this), strikeToTransfer),
            "Could not transfer strike tokens from caller"
        );

        address optionAddress = address(option);

        strikeAsset.approve(optionAddress, strikeToTransfer);
        option.mint(amount, msg.sender);

        IUniswapExchange optionExchange = getExchange(optionAddress);

        uint256 minEthBought = 1;

        try
            optionExchange.tokenToTokenTransferInput(
                amount,
                minOutputAmount,
                minEthBought,
                deadline,
                msg.sender,
                outputToken
            )
        returns (uint256 tokensBought) {
            emit OptionsSold(msg.sender, optionAddress, amount, outputToken, tokensBought);
        } catch {
            revert("Uniswap trade failed");
        }
    }

//    function buyExactOptions(
//        address optionAddress,
//        uint256 amount,
//        uint256 maxTokensSold,
//        address tokenInput
//    ) external {
//        IUniswapExchange exchangeOption = getExchange(optionAddress);
//
//        uint256 maxEthSold = 1;
//        uint256 deadline = now + 1;
//
//        try
//            exchangeOption.tokenToTokenTransferOutput(
//                amount,
//                maxTokensSold,
//                maxEthSold,
//                deadline,
//                msg.sender,
//                tokenInput
//            )
//        returns (uint256 tokensSold) {
//            emit OptionsBought(msg.sender, optionAddress, amount, tokenInput, tokensSold);
//        } catch {
//            revert("Uniswap trade failed");
//        }
//    }

//    function buyOptionsWithExactTokens(
//        address optionAddress,
//        uint256 amount,
//        address tokenInput
//    ) external {
//        IUniswapExchange exchangeOption = getExchange(optionAddress);
//    }

//    function sellOption(address optionAddress) external {
//        IUniswapExchange exchangeOption = getExchange(optionAddress);
//    }

    function getExchange(address _optionAddress) internal view returns(IUniswapExchange) {
        address exchangeOptionAddress = uniswapFactory.getExchange(_optionAddress);
        require(exchangeOptionAddress != address(0), "Exchange not found");
        return IUniswapExchange(exchangeOptionAddress);
    }
}
