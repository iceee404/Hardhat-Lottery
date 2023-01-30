const { inputToConfig } = require("@ethereum-waffle/compiler");
const { assert, expect } = require("chai");
const { network, deployments, ethers, getNamedAccounts } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

//只有是测试链才能去跑测试
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle, deployer, raffleEntranceFee, interval, raffleContract;

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
              raffleContract = await ethers.getContract("Raffle"); // Returns a new connection to the Raffle contract

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

              describe("fulfillRandomWords", function () {
                  beforeEach(async () => {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.request({ method: "evm_mine", params: [] });
                  });
                  it("can only be called after performupkeep", async () => {
                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address) // reverts if not fulfilled
                      ).to.be.revertedWith("nonexistent request");
                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address) // reverts if not fulfilled
                      ).to.be.revertedWith("nonexistent request");
                  });

                  // This test is too big...
                  // This test simulates users entering the raffle and wraps the entire functionality of the raffle
                  // inside a promise that will resolve if everything is successful.
                  // An event listener for the WinnerPicked is set up
                  // Mocks of chainlink keepers and vrf coordinator are used to kickoff this winnerPicked event
                  // All the assertions are done once the WinnerPicked event is fired

                  it("picks a winer,resets and sends money", async () => {
                      const additionalEntrances = 3;
                      const startingIndex = 1;
                      const accounts = await ethers.getSigners();
                      console.log("==========================================");
                      console.log("玩家进入游戏：");

                      for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
                          console.log("玩家" + i + "地址:" + accounts[i].address.toString());

                          const accountConnectedRaffle = raffleContract.connect(accounts[i]);
                          await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
                      }
                      console.log("==========================================");

                      const startingTimeStamp = await raffle.getLastTimeStamp(); // stores starting timestamp (before we fire our event)

                      //创建一个promise，以保证监听器不会再抽奖未结束时就停止工作
                      await new Promise(async (resolve, reject) => {
                          //一个事件监听器
                          //当开奖发奖金方法fullfillrandomword调用结束时emit WinnerPicked事件后，会触发此函数
                          raffle.once("WinnerPicked", async () => {
                              // event listener for WinnerPicked
                              console.log("WinnerPicked event fired!");
                              // assert throws an error if it fails, so we need to wrap
                              // it in a try/catch so that the promise returns event
                              // if it fails.
                              try {
                                  // Now lets get the ending values...
                                  //把游戏结束后的状态记录好
                                  const recentWinner = await raffle.getRecentWinner();
                                  console.log("==========================================");
                                  console.log(recentWinner.toString());
                                  console.log("==========================================");

                                  const raffleState = await raffle.getRaffleState();
                                  const winnerBalance = await accounts[1].getBalance();
                                  const endingTimeStamp = await raffle.getLastTimeStamp();
                                  //player数组应被重置清零
                                  await expect(raffle.getPlayer(0)).to.be.reverted;
                                  // Comparisons to check if our ending values are correct:
                                  assert.equal(recentWinner.toString(), accounts[1].address);
                                  assert.equal(raffleState, 0);
                                  assert.equal(
                                      winnerBalance.toString(),
                                      startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                          .add(
                                              raffleEntranceFee
                                                  .mul(additionalEntrances)
                                                  .add(raffleEntranceFee)
                                          )
                                          .toString()
                                  );
                                  assert(endingTimeStamp > startingTimeStamp);
                                  resolve(); // if try passes, resolves the promise
                              } catch (e) {
                                  reject(e); // if try fails, rejects the promise
                              }
                          });

                          // kicking off the event by mocking the chainlink keepers and vrf coordinator
                          //模拟chainlink keepers and vrf coordinator完成随机数生成和调用开奖函数
                          const tx = await raffle.performUpkeep("0x");
                          const txReceipt = await tx.wait(1);
                          const startingBalance = await accounts[1].getBalance();
                          await vrfCoordinatorV2Mock.fulfillRandomWords(
                              txReceipt.events[1].args.requestId,
                              raffle.address
                          );
                      });
                  });
              });
          });
      });
