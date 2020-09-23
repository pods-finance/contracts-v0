
internalTask('deployOptionExchange', 'Deploy new option exchange using provider')
  .addParam('provider', 'String representing provider name (E.g: UniswapV1Provider)')
  .addParam('factory', 'String of the factory name to pass to initialize')
  .setAction(async ({ provider, factory }, bre) => {
    const factoryAddress = require(`../deployments/${bre.network.name}.json`)[factory]
    console.log('----- Start Option Exchange Deployment -------')
    console.log('provider: ', provider)
    console.log('factory: ', factory)
    const ExchangeProvider = await ethers.getContractFactory(provider)
    // 1) Deploy provider
    console.log('1) Deploying provider...')
    const exchangeProvider = await ExchangeProvider.deploy()

    await exchangeProvider.deployed()
    console.log('1) Provider deployed at: ', exchangeProvider.address)
    // 2) Initialize Provider
    console.log('2) Initializing Provider...')
    await exchangeProvider.initialize(factoryAddress)
    console.log('2) Provider Initialized')
    // 3) Deploy Option Exchange
    const ExchangeContract = await ethers.getContractFactory('OptionExchange')
    console.log('3) Deploying Option Exchange ...')
    const optionExchange = await ExchangeContract.deploy(exchangeProvider.address)
    console.log('3) Option Exchange Address: ', optionExchange.address)
    console.log('----- End Option Exchange Deployment -------')
  })
