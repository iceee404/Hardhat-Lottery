//SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

//引入chainlinkvrf消费者合约
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";

//定义一个error去revert相比于你去require更节省gas
error Raffle_NotEnoughETHEntered();

contract Raffle is VRFConsumerBaseV2 {
    //定义进入彩票合约的门槛不可变
    uint256 private immutable i_entranceFee;

    //保存每个参与者，数组一定是payable的
    address payable[] private s_players;

    //定义一个事件方便记录,这种方法的Gas效率比将内容保存在Storage里要高
    //定义在event里的数据，以特殊数据保存在evm日志里，智能合约无法访问，但是前端可以
    //添加indexed方便前端查找，在一些变量变化后记录事件进去，前端可以做出有效反馈
    event RaffleEnter(address indexed player);

    //构造函数，初始化不可变变量
    constructor(address vrfCoordinatorV2, uint256 entranceFee) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
    }

    //进入合约，判断购买金额是否达到要求，符合即代表参与彩票合约，将此付款地址记录，并emit event
    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert Raffle_NotEnoughETHEntered();
        }
        s_players.push(payable(msg.sender));

        //Emit an event when we update a dynamic array or mapping
        //Name events with the function name reversed
        emit RaffleEnter(msg.sender);
    }

    //从参与者中选出获胜者，利用chainlink vrf
    //此函数只会被chainlink keepers network 自动调用
    function pickRandomWinner() external {}

    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {}

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }
}
