// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./DailyWeatherStore.sol";

/// Chi dung cho test: khong rang buoc "ngay da ket thuc" va "qua cu", van giu quy tac 1 ngay 1 ban ghi.
contract MockWeatherOracle is DailyWeatherStore, Ownable {
    constructor() Ownable(msg.sender) {}

    function setDailyData(
        bytes32 regionId,
        uint8 perilType,
        uint256 dayStart,
        uint256 value
    ) external onlyOwner {
        _storeDaily(regionId, perilType, dayStart, value, 0, 0);
    }

    /// Tien cho test: ghi cung 1 value cho dayCount ngay lien tiep tu fromDayStart.
    function setDailyRange(
        bytes32 regionId,
        uint8 perilType,
        uint256 fromDayStart,
        uint256 dayCount,
        uint256 valuePerDay
    ) external onlyOwner {
        require(dayCount > 0 && dayCount <= MAX_RANGE_DAYS, "dayCount khong hop le");
        for (uint256 i = 0; i < dayCount; i++) {
            _storeDaily(regionId, perilType, fromDayStart + i * 1 days, valuePerDay, 0, 0);
        }
    }
}
