// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IWeatherOracle {
    function getWeatherData(bytes32 regionId) external view returns (uint256 value, uint256 timestamp);
}

