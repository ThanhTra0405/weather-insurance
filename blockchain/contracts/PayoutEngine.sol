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
    // Cua so tong mua cua han han (value = tong mua 30 ngay ket thuc tai ts)
    uint256 public constant DROUGHT_WINDOW = 30 days;

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

        (uint256 value, uint256 ts) = oracle.getWeatherData(
            pol.regionId,
            perilType
        );
        // startTime đã bao gồm cooling-off (PolicyManager.verifyPolicy set),
        // nên dữ liệu trước mốc này không được tính
        if (ts < pol.startTime) return false;

        if (perilType == 0) {
            // Han han: cua so 30 ngay phai nam hoan toan trong thoi gian co hieu luc
            if (ts < pol.startTime + DROUGHT_WINDOW) return false;
            return value < threshold;
        }
        // Lu, gio manh
        return value > threshold;
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

        // Chống mua policy sau khi đã biết trước thiên tai:
        // chỉ nhận dữ liệu oracle sau startTime (= thời điểm duyệt + cooling-off)
        (, , uint8 perilType, , , , , ) = policyManager.products(
            pol.productId
        );
        (, uint256 ts) = oracle.getWeatherData(pol.regionId, perilType);
        require(ts >= pol.startTime, "Du lieu truoc thoi diem hieu luc");

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