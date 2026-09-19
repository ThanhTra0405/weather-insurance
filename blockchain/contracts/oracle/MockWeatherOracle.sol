// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../../interfaces/IWeatherOracle.sol";
contract MockWeatherOracle is IWeatherOracle, Ownable {
    struct Data { uint256 value; uint256 timestamp; }
    mapping(bytes32 => Data) private data;

    constructor() Ownable(msg.sender) {}

    function setWeatherData(bytes32 regionId, uint256 value, uint256 timestamp) external onlyOwner {
        data[regionId] = Data(value, timestamp);
    }

    function getWeatherData(bytes32 regionId) external view returns (uint256, uint256) {
        Data memory d = data[regionId];
        return (d.value, d.timestamp);
    }
}
