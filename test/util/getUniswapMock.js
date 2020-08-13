const { deployMockContract } = waffle
const UniswapFactoryABI = require('../../abi/uniswap_factory.json')
const UniswapExchangeABI = require('../../abi/uniswap_exchange.json')

module.exports = async function getUniswapMock (deployer) {
  const uniswapFactory = await deployMockContract(deployer, UniswapFactoryABI)

  await uniswapFactory.mock.getExchange.returns(ethers.constants.AddressZero)

  const createExchange = async (tokenAddress, boughtTokens) => {
    const uniswapExchange = await deployMockContract(deployer, UniswapExchangeABI)

    await uniswapFactory.mock.getExchange
      .withArgs(tokenAddress)
      .returns(uniswapExchange.address)

    await uniswapExchange.mock.tokenToTokenTransferInput
      .returns(boughtTokens)

    return uniswapExchange
  }

  return {
    uniswapFactory,
    createExchange
  }
}
