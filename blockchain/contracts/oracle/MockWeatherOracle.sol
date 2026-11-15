// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../../interfaces/IWeatherOracle.sol";

contract MockWeatherOracle is IWeatherOracle, Ownable {
    struct Data { uint256 value; uint256 timestamp; }
    mapping(bytes32 => mapping(uint8 => Data)) private data;

    constructor() Ownable(msg.sender) {}

    function setWeatherData(
        bytes32 regionId,
        uint8 perilType,
        uint256 value,
        uint256 timestamp
    ) external onlyOwner {
        require(perilType <= 2, "peril khong hop le");
        data[regionId][perilType] = Data(value, timestamp);
    }

    function getWeatherData(
        bytes32 regionId,
        uint8 perilType
    ) external view returns (uint256, uint256) {
        Data memory d = data[regionId][perilType];
        return (d.value, d.timestamp);
    }
}
