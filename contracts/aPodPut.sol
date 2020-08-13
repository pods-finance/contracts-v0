// SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "./PodPut.sol";
import "@nomicLabs/buidler/console.sol";

/**
 * Represents a tokenized american put option series for some
 * long/short token pair.
 *
 * It is fungible and it is meant to be freely tradeable until its
 * expiration time, when its transfer functions will be blocked
 * and the only available operation will be for the option writers
 * to unlock their collateral.
 *
 * Let's take an example: there is such a put option series where buyers
 * may sell 1 DAI for 1 USDC until Dec 31, 2019.
 *
 * In this case:
 *
 * - Expiration date: Dec 31, 2019
 * - Underlying asset: DAI
 * - Strike asset: USDC
 * - Strike price: 1 USDC
 *
 * USDC holders may call mint() until the expiration date, which in turn:
 *
 * - Will lock their USDC into this contract
 * - Will issue put tokens corresponding to this USDC amount
 * - These put tokens will be freely tradable until the expiration date
 *
 * USDC holders who also hold the option tokens may call burn() until the
 * expiration date, which in turn:
 *
 * - Will unlock their USDC from this contract
 * - Will burn the corresponding amount of put tokens
 *
 * Put token holders may call redeem() until the expiration date, to
 * exercise their option, which in turn:
 *
 * - Will sell 1 DAI for 1 USDC (the strike price) each.
 * - Will burn the corresponding amounty of put tokens.
 */
contract aPodPut is PodPut {
    using SafeMath for uint8;
    mapping(address => uint256) public weightedBalances;
    uint256 public totalLockedWeighted = 0;

    constructor(
        string memory _name,
        string memory _symbol,
        PodOption.OptionType _optionType,
        address _underlyingAsset,
        address _strikeAsset,
        uint256 _strikePrice,
        uint256 _expirationBlockNumber,
        address _uniswapFactory
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
    {}

    /**
     * Locks some amount of the strike token and writes option tokens.
     *
     * The issued amount ratio is 1:1, i.e., 1 option token for 1 underlying token.
     *
     * It presumes the caller has already called IERC20.approve() on the
     * strike token contract to move caller funds.
     *
     * This function is meant to be called by strike token holders wanting
     * to write option tokens.
     *
     * Options can only be minted while the series is NOT expired.
     *
     * @param amount The amount option tokens to be issued; this will lock
     * for instance amount * strikePrice units of strikeToken into this
     * contract
     */
    function mint(uint256 amount) external override beforeExpiration {
        require(amount > 0, "Null amount");

        uint256 amountToTransfer = amount.mul(strikePrice).div(
            10**underlyingAssetDecimals.add(strikePriceDecimals).sub(strikeAssetDecimals)
        );
        require(amountToTransfer > 0, "You need to increase amount");

        if (totalLockedWeighted > 0) {
            uint256 strikeReserves = ERC20(strikeAsset).balanceOf(address(this));
            uint256 userLockedWeighted = amountToTransfer.mul(totalLockedWeighted).div(strikeReserves) + 1;
            totalLockedWeighted = totalLockedWeighted.add(userLockedWeighted);
            weightedBalances[msg.sender] = weightedBalances[msg.sender].add(userLockedWeighted);
        } else {
            weightedBalances[msg.sender] = amountToTransfer;
            totalLockedWeighted = amountToTransfer;
        }

        _mint(msg.sender, amount);
        require(
            ERC20(strikeAsset).transferFrom(msg.sender, address(this), amountToTransfer),
            "Couldn't transfer strike tokens from caller"
        );
    }

    // /**
    //  * Unlocks some amount of the strike token by burning option tokens.
    //  *
    //  * This mechanism ensures that users can only redeem tokens they've
    //  * previously lock into this contract.
    //  *
    //  * Options can only be burned while the series is NOT expired.
    //  */
    // function burn(uint256 amount) external override beforeExpiration {
    //     require(amount <= lockedBalance[msg.sender], "Not enough underlying balance");

    //     uint256 amountToTransfer = amount.mul(strikePrice).div(
    //         10**underlyingAssetDecimals.add(strikePriceDecimals).sub(strikeAssetDecimals)
    //     );

    //     // Burn option tokens
    //     lockedBalance[msg.sender] = lockedBalance[msg.sender].sub(amount);
    //     _burn(msg.sender, amount);

    //     require(amountToTransfer > 0, "You need to increase amount");
    //     // Unlocks the strike token
    //     require(
    //         ERC20(strikeAsset).transfer(msg.sender, amountToTransfer),
    //         "Couldn't transfer back strike tokens to caller"
    //     );
    // }

    /**
     * After series expiration, allow addresses who have locked their strike
     * asset tokens to withdraw them on first-come-first-serve basis.
     *
     * If there is not enough of strike asset because the series have been
     * exercised, the remaining balance is converted into the underlying asset
     * and given to the caller.
     */
    function withdraw() external override afterExpiration {
        uint256 weightedBalance = weightedBalances[msg.sender];
        require(weightedBalance > 0, "You do not have balance to withdraw");
        // Calculates how many underlying/strike tokens the caller
        // will get back
        uint256 strikeReserves = ERC20(strikeAsset).balanceOf(address(this));
        uint256 underlyingReserves = ERC20(underlyingAsset).balanceOf(address(this));
        uint256 strikeToReceive = weightedBalance.mul(strikeReserves).div(totalLockedWeighted);
        uint256 underlyingToReceive = weightedBalance.mul(underlyingReserves).div(totalLockedWeighted);
        weightedBalances[msg.sender] = weightedBalances[msg.sender].sub(weightedBalance);
        totalLockedWeighted = totalLockedWeighted.sub(weightedBalance);

        require(
            ERC20(strikeAsset).transfer(msg.sender, strikeToReceive),
            "Couldn't transfer back strike tokens to caller"
        );
        if (underlyingReserves > 0) {
            require(
                ERC20(underlyingAsset).transfer(msg.sender, underlyingToReceive),
                "Couldn't transfer back strike tokens to caller"
            );
        }
    }

    function _redeem(uint256 weightedBalance) internal {}
}
