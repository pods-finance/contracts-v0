const { expect } = require('chai')

const OPTION_TYPE_PUT = 0

const scenarios = [
  {
    name: 'ETH/USDC',
    underlyingAssetSymbol: 'WETH',
    underlyingAssetDecimals: 18,
    strikeAssetSymbol: 'USDC',
    strikeAssetDecimals: 6,
    strikePrice: ethers.BigNumber.from(300e6.toString()),
    strikePriceDecimals: 6,
    expirationDate: 900000,
    amountToMint: ethers.BigNumber.from(1e18.toString()),
    amountToMintTooLow: 1
  },
  {
    name: 'ETH/DAI',
    underlyingAssetSymbol: 'WETH',
    underlyingAssetDecimals: 18,
    strikeAssetSymbol: 'DAI',
    strikeAssetDecimals: 18,
    strikePrice: ethers.BigNumber.from(300e6.toString()),
    strikePriceDecimals: 6,
    expirationDate: 900000,
    amountToMint: ethers.BigNumber.from(1e18.toString()),
    amountToMintTooLow: 1
  }
]
scenarios.forEach(scenario => {
  describe('wPodPut.sol - ' + scenario.name, () => {
    let mockUnderlyingAsset
    let mockStrikeAsset
    let factoryContract
    let podPut
    let deployer
    let deployerAddress
    let seller
    let sellerAddress
    let buyer
    let buyerAddress
    let txIdNewOption

    before(async function () {
      [deployer, seller, buyer] = await ethers.getSigners()
      deployerAddress = await deployer.getAddress()
      sellerAddress = await seller.getAddress()
      buyerAddress = await buyer.getAddress()

      // 1) Deploy Factory
      const ContractFactory = await ethers.getContractFactory('OptionFactory')
      factoryContract = await ContractFactory.deploy()
      await factoryContract.deployed()
    })

    beforeEach(async function () {
      // const podPut = await ethers.getContractFactory('podPut')
      const MockERC20 = await ethers.getContractFactory('MintableERC20')
      const MockWETH = await ethers.getContractFactory('WETH')
      const WPodPut = await ethers.getContractFactory('wPodPut')

      mockUnderlyingAsset = await MockWETH.deploy()
      mockStrikeAsset = await MockERC20.deploy(scenario.strikeAssetSymbol, scenario.strikeAssetSymbol, scenario.strikeAssetDecimals)

      await mockUnderlyingAsset.deployed()
      await mockStrikeAsset.deployed()

      // call transaction
      txIdNewOption = await factoryContract.createEthOption(
        scenario.name,
        scenario.name,
        OPTION_TYPE_PUT,
        mockUnderlyingAsset.address,
        mockStrikeAsset.address,
        scenario.strikePrice,
        await ethers.provider.getBlockNumber() + 300, // expirationDate = high block number
        mockUnderlyingAsset.address
      )

      // await podPut.deployed()


      const filterFrom = await factoryContract.filters.OptionCreated(deployerAddress)
      const eventDetails = await factoryContract.queryFilter(filterFrom, txIdNewOption.blockNumber, txIdNewOption.blockNumber)

      if (eventDetails.length) {
        const { option } = eventDetails[0].args
        podPut = await ethers.getContractAt('wPodPut', option)
      } else {
        console.log('Something went wrong: No events found')
      }

      await podPut.deployed()
    })

    // Aux function used to get Transaction Cost (Gas Used * Gas Price using Ethers.js)
    // Input: txObject returned using ethers.js
    // Returns BigNumber representing txCost
    async function getTxCost (tx) {
      const txReceipt = await tx.wait()
      const gasPrice = tx.gasPrice
      const gasUsed = txReceipt.gasUsed
      const txCost = gasPrice.mul(gasUsed)
      return txCost
    }

    async function MintPhase (amountOfOptionsToMint) {
      expect(await podPut.balanceOf(sellerAddress)).to.equal(0)

      await mockStrikeAsset.connect(seller).approve(podPut.address, ethers.constants.MaxUint256)
      // calculate amount of Strike necessary to mint
      await mockStrikeAsset.connect(seller).mint(scenario.strikePrice)

      expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(scenario.strikePrice)
      await podPut.connect(seller).mint(amountOfOptionsToMint)
      expect(await podPut.balanceOf(sellerAddress)).to.equal(amountOfOptionsToMint)
      expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(0)
    }

    async function ExercisePhase (amountOfOptionsToExercise) {
      await podPut.connect(seller).transfer(buyerAddress, amountOfOptionsToExercise)

      const initialBuyerOptionBalance = await podPut.balanceOf(buyerAddress)
      const initialBuyerUnderlyingBalance = await ethers.provider.getBalance(buyerAddress)
      const initialContractUnderlyingBalance = await podPut.underlyingBalance()
      const initialContractOptionSupply = await podPut.totalSupply()

      expect(initialBuyerOptionBalance).to.equal(amountOfOptionsToExercise)
      expect(initialContractUnderlyingBalance).to.equal(0)
      expect(initialContractOptionSupply).to.equal(scenario.amountToMint)
      const txExercise = await podPut.connect(buyer).exchangeEth({ value: amountOfOptionsToExercise })
      const txCost = await getTxCost(txExercise)

      const finalBuyerOptionBalance = await podPut.balanceOf(buyerAddress)
      const finalBuyerUnderlyingBalance = await ethers.provider.getBalance(buyerAddress)
      const finalContractUnderlyingBalance = await podPut.underlyingBalance()
      const finalContractOptionSupply = await podPut.totalSupply()

      expect(finalBuyerOptionBalance).to.equal(0)
      expect(finalBuyerUnderlyingBalance).to.equal(initialBuyerUnderlyingBalance.sub(amountOfOptionsToExercise).sub(txCost))
      expect(finalContractUnderlyingBalance).to.equal(amountOfOptionsToExercise)
      expect(finalContractOptionSupply).to.equal(initialContractOptionSupply.sub(amountOfOptionsToExercise))
    }

    async function forceExpiration (untilThisBlock) {
      let currentBlock = await ethers.provider.getBlockNumber()
      while (currentBlock <= untilThisBlock) {
        await ethers.provider.send('evm_mine')
        currentBlock++
      }
    }

    describe('Constructor/Initialization checks', () => {
      it('should have correct number of decimals for underlying and strike asset', async () => {
        expect(await podPut.strikeAssetDecimals()).to.equal(scenario.strikeAssetDecimals)
        expect(await podPut.underlyingAssetDecimals()).to.equal(scenario.underlyingAssetDecimals)
      })

      it('should have equal number of decimals PodPut and underlyingAsset', async () => {
        expect(await podPut.decimals()).to.equal(scenario.underlyingAssetDecimals)
      })

      it('should have equal number of decimals StrikePrice and strikeAsset', async () => {
        expect(await podPut.strikePriceDecimals()).to.equal(await podPut.strikeAssetDecimals())
      })
    })

    describe('Minting options', () => {
      it('should revert if user dont have enough collateral', async () => {
        expect(await podPut.balanceOf(sellerAddress)).to.equal(0)

        await mockStrikeAsset.connect(seller).approve(podPut.address, ethers.constants.MaxUint256)

        expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(0)
        await expect(podPut.connect(seller).mint(scenario.amountToMint)).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      })

      it('should revert if user do not approve collateral to be spended by PodPut', async () => {
        expect(await podPut.balanceOf(sellerAddress)).to.equal(0)

        await mockStrikeAsset.connect(seller).mint(scenario.strikePrice)

        expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(scenario.strikePrice)

        await expect(podPut.connect(seller).mint(scenario.amountToMint)).to.be.revertedWith('ERC20: transfer amount exceeds allowance')
      })

      it('should revert if asked amount is too low', async () => {
        const minimumAmount = ethers.BigNumber.from(scenario.strikePrice).div((10 ** await mockUnderlyingAsset.decimals()).toString())

        if (minimumAmount.gt(0)) return

        expect(await podPut.balanceOf(sellerAddress)).to.equal(0)

        await mockStrikeAsset.connect(seller).approve(podPut.address, ethers.constants.MaxUint256)
        await mockStrikeAsset.connect(seller).mint(scenario.strikePrice)

        expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(scenario.strikePrice)
        await expect(podPut.connect(seller).mint(scenario.amountToMintTooLow)).to.be.revertedWith('Amount too low')
      })

      it('should mint, increase senders option balance and decrease sender strike balance', async () => {
        expect(await podPut.balanceOf(sellerAddress)).to.equal(0)

        await mockStrikeAsset.connect(seller).approve(podPut.address, ethers.constants.MaxUint256)
        await mockStrikeAsset.connect(seller).mint(scenario.strikePrice)

        expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(scenario.strikePrice)
        await podPut.connect(seller).mint(scenario.amountToMint)
        expect(await podPut.balanceOf(sellerAddress)).to.equal(scenario.amountToMint)
        expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(0)
      })
      it('should revert if user try to mint after expiration', async () => {
        expect(await podPut.balanceOf(sellerAddress)).to.equal(0)

        await mockStrikeAsset.connect(seller).approve(podPut.address, ethers.constants.MaxUint256)
        await mockStrikeAsset.connect(seller).mint(scenario.strikePrice)

        expect(await mockStrikeAsset.balanceOf(sellerAddress)).to.equal(scenario.strikePrice)
        await forceExpiration(await podPut.expirationBlockNumber())
        await expect(podPut.connect(seller).mint(scenario.amountToMint)).to.be.revertedWith('Option has expired')
      })
    })

    describe('Exercising options', () => {
      it('should revert if user have underlying enough, but dont have enough options', async () => {
        expect(await ethers.provider.getBalance(buyerAddress)).to.gte(scenario.amountToMint)
        await expect(podPut.connect(buyer).exchangeEth({ value: scenario.amountToMint })).to.be.revertedWith('ERC20: burn amount exceeds balance')
      })
      it('should exercise and have all final balances matched', async () => {
        await MintPhase(scenario.amountToMint)
        // Transfer mint to Buyer address => This will happen through Uniswap
        await podPut.connect(seller).transfer(buyerAddress, scenario.amountToMint)

        const initialBuyerOptionBalance = await podPut.balanceOf(buyerAddress)
        const initialBuyerUnderlyingBalance = await ethers.provider.getBalance(buyerAddress)
        const initialContractUnderlyingBalance = await podPut.underlyingBalance()
        const initialContractStrikeBalance = await podPut.strikeBalance()
        const initialContractOptionSupply = await podPut.totalSupply()

        expect(initialBuyerOptionBalance).to.equal(scenario.amountToMint)
        // expect(initialBuyerUnderlyingBalance).to.equal(scenario.amountToMint)
        expect(initialContractUnderlyingBalance).to.equal(0)
        expect(initialContractStrikeBalance).to.equal(scenario.strikePrice)
        expect(initialContractOptionSupply).to.equal(scenario.amountToMint)
        const txExercise = await podPut.connect(buyer).exchangeEth({ value: scenario.amountToMint })

        const txCost = await getTxCost(txExercise)
        const finalBuyerOptionBalance = await podPut.balanceOf(buyerAddress)
        const finalBuyerUnderlyingBalance = await ethers.provider.getBalance(buyerAddress)
        const finalContractUnderlyingBalance = await podPut.underlyingBalance()
        const finalContractStrikeBalance = await podPut.strikeBalance()
        const finalContractOptionSupply = await podPut.totalSupply()

        expect(finalBuyerOptionBalance).to.equal(0)
        expect(finalBuyerUnderlyingBalance).to.equal(initialBuyerUnderlyingBalance.sub(scenario.amountToMint).sub(txCost))
        expect(finalContractUnderlyingBalance).to.equal(scenario.amountToMint)
        expect(finalContractStrikeBalance).to.equal(0)
        expect(finalContractOptionSupply).to.equal(0)
      })
      it('should revert if user try to exercise after expiration', async () => {
        await MintPhase(scenario.amountToMint)
        // Transfer mint to Buyer address => This will happen through Uniswap
        await podPut.connect(seller).transfer(buyerAddress, scenario.amountToMint)
        // Mint Underlying Asset
        await forceExpiration(await podPut.expirationBlockNumber())
        await expect(podPut.connect(seller).exchangeEth({ value: scenario.amountToMint })).to.be.revertedWith('Option has expired')
      })
    })

    describe('Burning options', () => {
      it('should revert if try to burn without amount', async () => {
        await expect(podPut.connect(seller).burn(scenario.amountToMint)).to.be.revertedWith('Not enough balance')
      })
      it('should revert if try to burn amount higher than possible', async () => {
        await MintPhase(scenario.amountToMint)
        await expect(podPut.connect(seller).burn(2 * scenario.amountToMint)).to.be.revertedWith('Not enough balance')
      })
      it('should burn, destroy sender option, reduce his balance and send strike back', async () => {
        await MintPhase(scenario.amountToMint)
        const initialSellerOptionBalance = await podPut.balanceOf(sellerAddress)
        const initialSellerStrikeBalance = await mockStrikeAsset.balanceOf(sellerAddress)
        const initialContractUnderlyingBalance = await podPut.underlyingBalance()
        const initialContractStrikeBalance = await podPut.strikeBalance()
        const initialContractOptionSupply = await podPut.totalSupply()

        expect(initialSellerOptionBalance).to.equal(scenario.amountToMint)
        expect(initialSellerStrikeBalance).to.equal(0)
        expect(initialContractUnderlyingBalance).to.equal(0)
        expect(initialContractStrikeBalance).to.equal(scenario.strikePrice)
        expect(initialContractOptionSupply).to.equal(scenario.amountToMint)
        await expect(podPut.connect(seller).burn(scenario.amountToMint))

        const finalSellerOptionBalance = await podPut.balanceOf(sellerAddress)
        const finalSellerStrikeBalance = await mockStrikeAsset.balanceOf(sellerAddress)
        const finalContractUnderlyingBalance = await podPut.underlyingBalance()
        const finalContractStrikeBalance = await podPut.strikeBalance()
        const finalContractOptionSupply = await podPut.totalSupply()

        expect(finalSellerOptionBalance).to.equal(0)
        expect(finalSellerStrikeBalance).to.equal(scenario.strikePrice)
        expect(finalContractStrikeBalance).to.equal(0)
        expect(finalContractOptionSupply).to.equal(0)
        expect(finalContractUnderlyingBalance).to.equal(0)
      })
      it('should revert if user try to burn after expiration', async () => {
        await forceExpiration(await podPut.expirationBlockNumber())
        await expect(podPut.connect(seller).burn()).to.be.revertedWith('Option has not expired yet')
      })
    })

    describe('Withdrawing options', () => {
      it('should revert if user try to withdraw before expiration', async () => {
        await expect(podPut.connect(seller).withdraw()).to.be.revertedWith('Option has not expired yet')
      })

      it('should revert if user try to withdraw without balance after expiration', async () => {
        // Set Expiration
        const optionExpiration = await podPut.expirationBlockNumber()
        await forceExpiration(optionExpiration)

        await expect(podPut.connect(seller).withdraw()).to.be.revertedWith('You do not have balance to withdraw')
      })

      it('should withdraw exact amount of Strike Asset', async () => {
        await MintPhase(scenario.amountToMint)
        // Set Expiration
        const initialSellerOptionBalance = await podPut.balanceOf(sellerAddress)
        const initialSellerStrikeBalance = await mockStrikeAsset.balanceOf(sellerAddress)
        const initialContractStrikeBalance = await podPut.strikeBalance()

        expect(initialSellerOptionBalance).to.equal(scenario.amountToMint)
        expect(initialSellerStrikeBalance).to.equal(0)
        expect(initialContractStrikeBalance).to.equal(scenario.strikePrice)

        const optionExpiration = await podPut.expirationBlockNumber()
        await forceExpiration(optionExpiration)

        await podPut.connect(seller).withdraw()

        const finalSellerOptionBalance = await podPut.balanceOf(sellerAddress)
        const finalSellerStrikegBalance = await mockStrikeAsset.balanceOf(sellerAddress)
        const finalContractStrikeBalance = await podPut.strikeBalance()

        expect(finalSellerOptionBalance).to.equal(scenario.amountToMint)
        expect(finalSellerStrikegBalance).to.equal(scenario.strikePrice)
        expect(finalContractStrikeBalance).to.equal(0)
        // Cant withdraw two times in a row
        await expect(podPut.connect(seller).withdraw()).to.be.revertedWith('You do not have balance to withdraw')
      })

      it('should withdraw mixed amount of Strike Asset and Underlying Asset', async () => {
        const halfAmountMint = ethers.BigNumber.from(scenario.amountToMint).div(2)
        await MintPhase(scenario.amountToMint)
        // Exercise half amount of options
        await ExercisePhase(halfAmountMint)
        // Checking balance before withdraw
        const initialSellerOptionBalance = await podPut.balanceOf(sellerAddress)
        const initialSellerUnderlyingBalance = await ethers.provider.getBalance(sellerAddress)
        const initialSellerStrikeBalance = await mockStrikeAsset.balanceOf(sellerAddress)
        const initialContractStrikeBalance = await podPut.strikeBalance()
        const initialContractUnderlyingBalance = await podPut.underlyingBalance()

        expect(initialSellerOptionBalance).to.equal(halfAmountMint)
        expect(initialSellerStrikeBalance).to.equal(0)
        expect(initialContractStrikeBalance).to.equal(ethers.BigNumber.from(scenario.strikePrice).div(2))
        expect(initialContractUnderlyingBalance).to.equal(halfAmountMint)

        const optionExpiration = await podPut.expirationBlockNumber()
        await forceExpiration(optionExpiration)
        const txWithdraw = await podPut.connect(seller).withdraw()
        const txCost = await getTxCost(txWithdraw)

        const finalSellerOptionBalance = await podPut.balanceOf(sellerAddress)
        const finalSellerUnderlyingBalance = await ethers.provider.getBalance(sellerAddress)
        const finalSellerStrikeBalance = await mockStrikeAsset.balanceOf(sellerAddress)
        const finalContractStrikeBalance = await podPut.strikeBalance()
        const finalContractUnderlyingBalance = await podPut.underlyingBalance()

        expect(finalSellerOptionBalance).to.equal(halfAmountMint)
        expect(finalSellerUnderlyingBalance).to.equal(initialSellerUnderlyingBalance.add(halfAmountMint).sub(txCost))
        expect(finalSellerStrikeBalance).to.equal(ethers.BigNumber.from(scenario.strikePrice).div(2))
        expect(finalContractStrikeBalance).to.equal(0)
        expect(finalContractUnderlyingBalance).to.equal(0)
        // Cant withdraw two times in a row
        await expect(podPut.connect(seller).withdraw()).to.be.revertedWith('You do not have balance to withdraw')
      })
    })
  })
})
