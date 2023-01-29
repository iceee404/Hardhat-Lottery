const { inputToConfig } = require("@ethereum-waffle/compiler");
const { assert, expect } = require("chai");
const { network, deployments, ethers, getNamedAccounts } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

//只有是测试链才能去跑测试
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle, deployer, raffleEntranceFee, interval;

          beforeEach(async () => {
              /*通过ethers得到部署者地址
              accounts = await ethers.getSigners();
              deployer = accounts[0]
              */
              //const { deployer } = await getNamedAccounts();

              deployer = (await getNamedAccounts()).deployer;

              await deployments.fixture(["all"]);
              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
              interval = await raffle.getInterval();
              raffleEntranceFee = await raffle.getEntranceFee();
          });

          describe("constructor", function () {
              it("Initializes the raffle correctly", async () => {
                  const raffleState = (await raffle.getRaffleState()).toString();
                  assert.equal(raffleState, "0");
                  assert.equal(
                      interval.toString(),
                      networkConfig[network.config.chainId]["keepersUpdateInterval"]
                  );
              });
          });

          describe("enterRaffle", function () {
              it("revert when you don't pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__SendMoreToEnterRaffle"
                  );
              });

              it("records player when they enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  const contractPlayer = await raffle.getPlayer(0);
                  assert.equal(contractPlayer, deployer);
              });

              it("emits event on enter", async () => {
                  // emits RaffleEnter event if entered to index player(s) address
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  );
              });

              it("doesn't allow when the raffleState is caculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  //手动让hardhat本地网络上的区块链推进一个时间点，这样就到了我们的开奖时间，enum就是caculating
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });

                  //假装成chainlink keepers 调用performUpkeep
                  await raffle.performUpkeep([]);
                  //此时在caculating状态肯定是revert的
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__RaffleNotOpen"
                  );
              });

              describe("checkUpkeep", function () {
                  it("returns false if people haven't sent any ETH", async () => {
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.request({ method: "evm_mine", params: [] });
                      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                      // const { upkeepNeeded } = await raffle.checkUpkeep("0x");
                      assert(!upkeepNeeded);
                  });
                  it("returns false if raffle isn't open", async () => {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.request({ method: "evm_mine", params: [] });
                      //时间已经到了，可以开奖了，可以调用performUpkeep开奖并把raffState设置为caculating
                      await raffle.performUpkeep([]); // changes the state to calculating
                      const raffleState = await raffle.getRaffleState(); // stores the new state
                      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                      assert.equal(raffleState.toString() == "1", upkeepNeeded == false);
                  });

                  it("returns false if enough time hasn't passed", async () => {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]); // use a higher number here if this test fails
                      await network.provider.request({ method: "evm_mine", params: [] });
                      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                      assert(!upkeepNeeded);
                  });

                  it("returns true if enough time has passed, has players, eth, and is open", async () => {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.request({ method: "evm_mine", params: [] });
                      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                      assert(upkeepNeeded);
                  });
              });

              describe("performUpkeep", function () {
                  it("can only run if checkupkeep is true", async () => {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.request({ method: "evm_mine", params: [] });
                      const tx = await raffle.performUpkeep("0x");
                      assert(tx);
                  });
                  it("reverts if checkup is false", async () => {
                      await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
                          "Raffle__UpkeepNotNeeded"
                      );
                  });
                  it("updates the raffle state and emits a requestId", async () => {
                      // Too many asserts in this test!
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.request({ method: "evm_mine", params: [] });
                      const txResponse = await raffle.performUpkeep("0x"); // emits requestId
                      const txReceipt = await txResponse.wait(1); // waits 1 block
                      const raffleState = await raffle.getRaffleState(); // updates state
                      const requestId = txReceipt.events[1].args.requestId;
                      assert(requestId.toNumber() > 0);
                      assert(raffleState == 1); // 0 = open, 1 = calculating
                  });
              });
          });
      });
