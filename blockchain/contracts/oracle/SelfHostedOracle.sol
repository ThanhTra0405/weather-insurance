// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/IWeatherOracle.sol";

contract SelfHostedOracle is IWeatherOracle, Ownable {
    struct Data {
        uint256 value;
        uint256 timestamp;
    }

    mapping(bytes32 => Data) private data;
    address public backendSigner;

    event BackendSignerSet(address indexed signer);
    event WeatherDataSubmitted(bytes32 indexed regionId, uint256 value, uint256 timestamp);

    modifier onlyBackend() {
        require(msg.sender == backendSigner, "Khong phai backend signer");
        _;
    }

    constructor(address _backendSigner) Ownable(msg.sender) {
        require(_backendSigner != address(0), "backendSigner = zero address");
        backendSigner = _backendSigner;
    }

    function setBackendSigner(address _backendSigner) external onlyOwner {
        require(_backendSigner != address(0), "backendSigner = zero address");
        backendSigner = _backendSigner;
        emit BackendSignerSet(_backendSigner);
    }

    function submitWeatherData(
        bytes32 regionId,
        uint256 value,
        uint256 timestamp
    ) external onlyBackend {
        data[regionId] = Data(value, timestamp);
        emit WeatherDataSubmitted(regionId, value, timestamp);
    }

    function getWeatherData(bytes32 regionId) external view returns (uint256, uint256) {
        Data memory d = data[regionId];
        return (d.value, d.timestamp);
    }
}