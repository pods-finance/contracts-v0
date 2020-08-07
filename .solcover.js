const shell = require("shelljs");

module.exports = {
  istanbulReporter: ["html"],
  skipFiles: ["mocks", "faucet.sol", "Migrations.sol", "aPodPut.sol"],
};