const { network } = require("hardhat");
const { developmentChains, networkConfig } = require("../helper-hardhat-config");
const { verify } = require("../utils/verify");

const FUND_AMOUNT = ethers.utils.parseEther("1"); // 1 Ether, or 1e18 (10^18) Wei

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments;
    const { deployer } = await getNamedAccounts();

    const chainId = network.config.chainId;
    let vrfCoordinatorV2Address, subscriptionId, vrfCoordinatorV2Mock;

    // Ensure the Raffle contract is a valid consumer of the VRFCoordinatorV2Mock contract.
    if (developmentChains.includes(network.name)) {
        const vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock");
        vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address;
        //这里调用的是合约里的方法，调用后你会得到一个承诺，所以必须加await等待这个promise
        const transactionResponse = await vrfCoordinatorV2Mock.createSubscription();
        const transactoinReceipt = await transactionResponse.wait(1);
        //获取方法里emit出的第一个event事件的参数里的subid
        subscriptionId = transactoinReceipt.events[0].args.subId;

        // Fund the subscription
        // Our mock makes it so we don't actually have to worry about sending fund
        //创建好订阅id，需要往里面fund link进去，（然后添加消费者合约address）
        await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, FUND_AMOUNT);
    } else {
        vrfCoordinatorV2Address = networkConfig[chainId][vrfCoordinatorV2];
        subscriptionId = networkConfig[chainId]["subscriptionId"];
    }

    //组装好部署Raffle需要的参数，其实就是构造函数的入参
    const arguments = [
        vrfCoordinatorV2Address,
        subscriptionId,
        networkConfig[chainId]["gasLane"],
        networkConfig[chainId]["keepersUpdateInterval"],
        networkConfig[chainId]["raffleEntranceFee"],
        networkConfig[chainId]["callbackGasLimit"],
    ];
    const raffle = await deploy("Raffle", {
        from: deployer,
        args: arguments,
        log: true,
        waitConfirmations: network.config.blockConfirmations || 1,
    });

    // Ensure the Raffle contract is a valid consumer of the VRFCoordinatorV2Mock contract.
    //本地测试网的话需要用mock去把抽奖合约添加进消费者，chainlink keepers去自动调用开奖
    //goerli测试网可以直接去chainlink官网ui界面添加消费者
    if (developmentChains.includes(network.name)) {
        const vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock");
        await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address);
    }

    //测试网上需要verify合约
    if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
        log("Verifying...");
        await verify(raffle.address, arguments);
    }
};

module.exports.tags = ["all", "raffle"];
