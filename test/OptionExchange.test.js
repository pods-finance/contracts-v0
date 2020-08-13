const { expect } = require('chai')
const getUniswapMock = require('./util/getUniswapMock')

describe.only('OptionExchange', () => {
  let ContractFactory, MockERC20, ExchangeContract, WETH
  let exchange, uniswapFactory, createExchange
  let underlyingAsset, strikeAsset, weth
  let podPut
  let deployer, deployerAddress
  let seller, sellerAddress
  let buyer, buyerAddress

  before(async () => {
    ;[deployer, seller, buyer, delegator] = await ethers.getSigners()
    deployerAddress = await deployer.getAddress()
    sellerAddress = await seller.getAddress()
    buyerAddress = await buyer.getAddress()

    let uniswapMock

    ;[ContractFactory, MockERC20, ExchangeContract, WETH, uniswapMock] = await Promise.all([
      ethers.getContractFactory('OptionFactory'),
      ethers.getContractFactory('MintableERC20'),
      ethers.getContractFactory('OptionExchange'),
      ethers.getContractFactory('WETH'),
      getUniswapMock(deployer)
    ])

    uniswapFactory = uniswapMock.uniswapFactory
    createExchange = uniswapMock.createExchange

    ;[underlyingAsset, strikeAsset, weth] = await Promise.all([
      MockERC20.deploy('WBTC', 'WBTC', 8),
      MockERC20.deploy('USDC', 'USDC', 6),
      WETH.deploy()
    ])
  })

  beforeEach(async () => {
    const factoryContract = await ContractFactory.deploy(weth.address)
    podPut = await makeOption(factoryContract, underlyingAsset, strikeAsset)
    exchange = await ExchangeContract.deploy(uniswapFactory.address)
  })

  it('assigns the exchange address correctly', async () => {
    expect(await exchange.uniswapFactory()).to.equal(uniswapFactory.address)
  })

  // describe('Buy', () => {
  //   it('buys the exact amount of options', async () => {
  //     const option = await makeOption(underlyingAsset, strikeAsset)
  //
  //     console.log(exchange.buyExactOptions(option.address, ))
  //   })

    // it('buys options with a exact amount of tokens', async () => {
    //
    // })

    // it('fails to buy when the exchange do not exist', async () => {})
  // })

  describe('Sell', () => {
    beforeEach(async () => {
      // Approving Strike Asset(Collateral) transfer into the Exchange
      await strikeAsset.connect(seller).approve(exchange.address, ethers.constants.MaxUint256)
    })

    it('sells the exact amount of options', async () => {
      const outputToken = strikeAsset.address
      const minOutputAmount = ethers.BigNumber.from(200e6.toString())
      const collateralAmount = await podPut.strikePrice()
      const amountToMint = ethers.BigNumber.from(1e8.toString())
      const deadline = await getTimestamp() + 60

      // Creates the Uniswap exchange
      await createExchange(podPut.address, minOutputAmount)

      await strikeAsset.connect(seller).mint(collateralAmount)
      expect(await strikeAsset.balanceOf(sellerAddress)).to.equal(collateralAmount)

      const tx = exchange.connect(seller).sellOptions(
        podPut.address,
        amountToMint,
        outputToken,
        minOutputAmount,
        deadline
      )

      await expect(tx)
        .to.emit(exchange, 'OptionsSold')
        .withArgs(sellerAddress, podPut.address, amountToMint, outputToken, minOutputAmount)
    })

    it('fails to sell when the exchange do not exist', async () => {
      const outputToken = strikeAsset.address
      const minOutputAmount = ethers.BigNumber.from(200e6.toString())
      const collateralAmount = await podPut.strikePrice()
      const amountToMint = ethers.BigNumber.from(1e8.toString())
      const deadline = await getTimestamp() + 60

      await strikeAsset.connect(seller).mint(collateralAmount)

      const tx = exchange.connect(seller).sellOptions(
        podPut.address,
        amountToMint,
        outputToken,
        minOutputAmount,
        deadline
      )

      await expect(tx).to.be.revertedWith('Exchange not found')

      // Burn unused tokens
      await strikeAsset.connect(seller).burn(collateralAmount)
    })

    it('fails when the deadline has passed', async () => {
      const outputToken = strikeAsset.address
      const minOutputAmount = ethers.BigNumber.from(200e6.toString())
      const collateralAmount = await podPut.strikePrice()
      const amountToMint = ethers.BigNumber.from(1e8.toString())
      const deadline = await getTimestamp() //

      // Creates the Uniswap exchange
      await createExchange(podPut.address, minOutputAmount)

      await strikeAsset.connect(seller).mint(collateralAmount)
      expect(await strikeAsset.balanceOf(sellerAddress)).to.equal(collateralAmount)

      const tx = exchange.connect(seller).sellOptions(
        podPut.address,
        amountToMint,
        outputToken,
        minOutputAmount,
        deadline
      )

      await expect(tx).to.be.revertedWith('Transaction timeout')
    })
  })
})

async function makeOption (factoryContract, underlyingAsset, strikeAsset) {
  const OptionTypePut = 0
  const strikePrice = ethers.BigNumber.from(8000e6.toString())

  const txIdNewOption = await factoryContract.createOption(
    'pod:WBTC:USDC:8000:A',
    'pod:WBTC:USDC:8000:A',
    OptionTypePut,
    underlyingAsset.address,
    strikeAsset.address,
    strikePrice,
    await ethers.provider.getBlockNumber() + 300, // expirationDate = high block number
    underlyingAsset.address
  )

  const [deployer] = await ethers.getSigners()
  const filterFrom = await factoryContract.filters.OptionCreated(await deployer.getAddress())
  const eventDetails = await factoryContract.queryFilter(filterFrom, txIdNewOption.blockNumber, txIdNewOption.blockNumber)

  const { option } = eventDetails[0].args
  return await ethers.getContractAt('PodPut', option)
}

async function getTimestamp () {
  const block = await ethers.provider.getBlock('latest')
  return block.timestamp
}
