// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../interfaces/IWeatherOracle.sol";
import "./PolicyManager.sol";

interface ILiquidityPoolPayout {
    function payOut(
        uint256 policyId,
        address recipient,
        uint256 amount
    ) external;
}

contract PayoutEngine is Ownable, Pausable, ReentrancyGuard {
    PolicyManager public policyManager;
    ILiquidityPoolPayout public liquidityPool;
    IWeatherOracle public oracle;

    event PayoutTriggered(
        uint256 indexed policyId,
        address indexed holder,
        uint256 amount
    );
    event OracleSet(address indexed oracle);

    constructor(
        address _policyManager,
        address _liquidityPool,
        address _oracle
    ) Ownable(msg.sender) {
        require(_policyManager != address(0), "policyManager = zero address");
        require(_liquidityPool != address(0), "liquidityPool = zero address");
        require(_oracle != address(0), "oracle = zero address");
        policyManager = PolicyManager(_policyManager);
        liquidityPool = ILiquidityPoolPayout(_liquidityPool);
        oracle = IWeatherOracle(_oracle);
    }

    function isThresholdMet(uint256 policyId) public view returns (bool) {
        PolicyManager.Policy memory pol = policyManager.getPolicy(policyId);
        (, , uint8 perilType, uint256 threshold, , , , ) = policyManager
            .products(pol.productId);

        (uint256 value, uint256 ts) = oracle.getWeatherData(pol.regionId);
        if (ts < pol.startTime) return false;

        // perilType 0 = han han (mua duoi nguong moi kich hoat)
        // perilType 1, 2 = lu / gio manh (mua/gio tren nguong moi kich hoat)
        if (perilType == 0) {
            return value < threshold;
        } else {
            return value > threshold;
        }
    }

    function checkAndPayout(
        uint256 policyId
    ) external whenNotPaused nonReentrant {
        PolicyManager.Policy memory pol = policyManager.getPolicy(policyId);
        require(
            pol.status == PolicyManager.PolicyStatus.Active,
            "Policy chua active hoac da dong"
        );
        require(block.timestamp <= pol.endTime, "Policy het han");

        (, uint256 ts) = oracle.getWeatherData(pol.regionId);
        require(ts >= pol.startTime, "Du lieu qua cu");
        require(isThresholdMet(policyId), "Chua dat nguong");

        liquidityPool.payOut(policyId, pol.holder, pol.coverageAmount);
        policyManager.markPaidOut(policyId);

        emit PayoutTriggered(policyId, pol.holder, pol.coverageAmount);
    }

    function setOracle(address newOracle) external onlyOwner whenPaused {
        require(newOracle != address(0), "oracle = zero address");
        oracle = IWeatherOracle(newOracle);
        emit OracleSet(newOracle);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
