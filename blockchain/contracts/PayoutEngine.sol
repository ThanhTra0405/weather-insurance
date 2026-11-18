// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../interfaces/IWeatherOracle.sol";
import "./PolicyManager.sol";
import "./libraries/DayTime.sol";

interface ILiquidityPoolPayout {
    function payOut(
        uint256 policyId,
        address recipient,
        uint256 amount
    ) external;
}

contract PayoutEngine is Ownable, Pausable, ReentrancyGuard {
    // Han han: TONG mua cua 30 ngay lich LIEN TIEP < threshold (cung don vi oracle: mm x100)
    uint256 public constant DROUGHT_WINDOW_DAYS = 30;

    PolicyManager public policyManager;
    ILiquidityPoolPayout public liquidityPool;
    IWeatherOracle public oracle;

    // Chong chi tra trung (ngoai trang thai policy va lockedAmount cua pool)
    mapping(uint256 => bool) public paidOut;

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

    function isThresholdMet(uint256 policyId) public view returns (bool met) {
        (met, , ) = evaluate(policyId);
    }

    /// observed: han han = tong mua cua cua so 30 ngay; lu/gio = gia tri cua ngay danh gia.
    /// validDays: so ngay co ban ghi hop le trong cua so (han han can du 30).
    function evaluate(
        uint256 policyId
    ) public view returns (bool met, uint256 observed, uint256 validDays) {
        PolicyManager.Policy memory pol = policyManager.getPolicy(policyId);
        (, , uint8 perilType, uint256 threshold, , , , ) = policyManager
            .products(pol.productId);

        // Cac ngay lich NAM TRON trong [startTime, endTime]:
        // khong dung du lieu truoc startTime, cung nhu sau endTime.
        uint256 firstDay = DayTime.dayIdOf(pol.startTime + 1 days - 1);
        uint256 lastDay = DayTime.dayIdOf(pol.endTime) - 1; // endTime >= 1 ngay nen khong underflow
        if (lastDay < firstDay) return (false, 0, 0);

        uint256 latest = oracle.latestDayId(pol.regionId, perilType);
        if (latest == 0) return (false, 0, 0);
        // Ngay cuoi cua bao hiem co the duoc oracle cap nhat SAU endTime: van danh gia den lastDay
        uint256 endDay = latest < lastDay ? latest : lastDay;
        if (endDay < firstDay) return (false, 0, 0);

        if (perilType == 0) {
            if (endDay + 1 < firstDay + DROUGHT_WINDOW_DAYS) return (false, 0, 0);
            uint256 startDay = endDay + 1 - DROUGHT_WINDOW_DAYS;
            (uint256 total, uint256 present) = oracle.sumDailyRange(
                pol.regionId,
                0,
                DayTime.dayStartOf(startDay),
                DROUGHT_WINDOW_DAYS
            );
            // Thieu ngay => khong danh gia (khong coi ngay thieu la 0 mm)
            if (present != DROUGHT_WINDOW_DAYS) return (false, total, present);
            return (total < threshold, total, present);
        }

        // Lu, gio manh: gia tri cua ngay gan nhat nam trong thoi gian bao hiem
        (bool exists, uint256 value) = oracle.getDailyData(
            pol.regionId,
            perilType,
            DayTime.dayStartOf(endDay)
        );
        if (!exists) return (false, 0, 0);
        return (value > threshold, value, 1);
    }

    function checkAndPayout(
        uint256 policyId
    ) external whenNotPaused nonReentrant {
        PolicyManager.Policy memory pol = policyManager.getPolicy(policyId);
        require(
            pol.status == PolicyManager.PolicyStatus.Active,
            "Policy chua active hoac da dong"
        );
        require(!paidOut[policyId], "Policy da duoc chi tra");
        // Het han xu ly boi thuong (claimDeadline >= endTime), khong phai het han bao hiem
        require(
            block.timestamp <= policyManager.getClaimDeadline(policyId),
            "Het han xu ly boi thuong"
        );
        require(isThresholdMet(policyId), "Chua dat nguong");

        paidOut[policyId] = true;
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
