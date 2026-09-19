interface IWeatherOracle {
    function getWeatherData(bytes32 regionId) external view returns (uint256 value, uint256 timestamp);
}

