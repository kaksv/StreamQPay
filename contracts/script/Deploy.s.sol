// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StreamPay} from "../src/StreamPay.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployScript {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;

    function run() external returns (StreamPay deployed) {
        require(block.chainid == 44005, "Aevum Testnet only");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        deployed = new StreamPay(IERC20(TUSD8));
        vm.stopBroadcast();
    }
}
