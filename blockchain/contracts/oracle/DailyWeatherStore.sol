// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../interfaces/IWeatherOracle.sol";
import "../libraries/DayTime.sol";

/// Kho du lieu theo ngay dung chung cho SelfHostedOracle va MockWeatherOracle.
abstract contract DailyWeatherStore is IWeatherOracle {
    uint256 public constant MAX_BATCH = 40;
    uint256 public constant MAX_RANGE_DAYS = 400;

    struct DailyRecord {
        bool exists;
        uint64 submittedAt;
        uint256 value;
    }

    // regionId => perilType => dayId => ban ghi
    mapping(bytes32 => mapping(uint8 => mapping(uint256 => DailyRecord))) internal daily;
    mapping(bytes32 => mapping(uint8 => uint256)) public override latestDayId;

    event DailyWeatherSubmitted(
        bytes32 indexed regionId,
        uint8 indexed perilType,
        uint256 indexed dayId,
        uint256 dayStart,
        uint256 value
    );

    // ===== Quy uoc ngay (cho Backend / UI doc) =====

    function dayIdOf(uint256 ts) external pure returns (uint256) {
        return DayTime.dayIdOf(ts);
    }

    function dayStartOf(uint256 dayId) external pure returns (uint256) {
        return DayTime.dayStartOf(dayId);
    }

    // ===== Doc =====

    function getWeatherData(
        bytes32 regionId,
        uint8 perilType
    ) external view override returns (uint256 value, uint256 timestamp) {
        uint256 id = latestDayId[regionId][perilType];
        if (id == 0) return (0, 0);
        return (daily[regionId][perilType][id].value, DayTime.dayStartOf(id));
    }

    function getDailyData(
        bytes32 regionId,
        uint8 perilType,
        uint256 dayStart
    ) external view override returns (bool exists, uint256 value) {
        require(DayTime.isDayStart(dayStart), "dayStart khong phai 00:00 UTC+7");
        DailyRecord storage r = daily[regionId][perilType][DayTime.dayIdOf(dayStart)];
        return (r.exists, r.value);
    }

    function sumDailyRange(
        bytes32 regionId,
        uint8 perilType,
        uint256 fromDayStart,
        uint256 dayCount
    ) external view override returns (uint256 total, uint256 present) {
        require(DayTime.isDayStart(fromDayStart), "dayStart khong phai 00:00 UTC+7");
        require(dayCount > 0 && dayCount <= MAX_RANGE_DAYS, "dayCount khong hop le");
        uint256 id = DayTime.dayIdOf(fromDayStart);
        for (uint256 i = 0; i < dayCount; i++) {
            DailyRecord storage r = daily[regionId][perilType][id + i];
            if (r.exists) {
                total += r.value;
                present++;
            }
        }
    }

    /// Phuc vu Backend phat hien ngay thieu: 1 call tra ve ca khoang.
    function getDailyRange(
        bytes32 regionId,
        uint8 perilType,
        uint256 fromDayStart,
        uint256 dayCount
    ) external view returns (bool[] memory exists, uint256[] memory values) {
        require(DayTime.isDayStart(fromDayStart), "dayStart khong phai 00:00 UTC+7");
        require(dayCount > 0 && dayCount <= MAX_RANGE_DAYS, "dayCount khong hop le");
        exists = new bool[](dayCount);
        values = new uint256[](dayCount);
        uint256 id = DayTime.dayIdOf(fromDayStart);
        for (uint256 i = 0; i < dayCount; i++) {
            DailyRecord storage r = daily[regionId][perilType][id + i];
            exists[i] = r.exists;
            values[i] = r.value;
        }
    }

    // ===== Ghi (noi bo) =====

    /// Gia tri toi da hop ly (x100), chan loi don vi / du lieu rac.
    function maxValueOf(uint8 perilType) public pure returns (uint256) {
        if (perilType == 0) return 150_000; // 1500 mm / ngay
        if (perilType == 1) return 450_000; // 4500 mm / 3 ngay
        return 50_000; // 500 km/h
    }

    function _storeDaily(
        bytes32 regionId,
        uint8 perilType,
        uint256 dayStart,
        uint256 value,
        uint256 minAgeSeconds,
        uint256 maxBackfillSeconds
    ) internal {
        require(perilType <= 2, "peril khong hop le");
        require(regionId != bytes32(0), "regionId rong");
        require(DayTime.isDayStart(dayStart), "dayStart khong phai 00:00 UTC+7");
        require(
            dayStart + minAgeSeconds <= block.timestamp,
            "Ngay chua ket thuc"
        );
        require(
            maxBackfillSeconds == 0 || block.timestamp - dayStart <= maxBackfillSeconds,
            "Ngay qua cu"
        );
        require(value <= maxValueOf(perilType), "Gia tri vuot nguong hop ly");

        uint256 id = DayTime.dayIdOf(dayStart);
        DailyRecord storage r = daily[regionId][perilType][id];
        require(!r.exists, "Da co du lieu cho ngay nay");

        r.exists = true;
        r.submittedAt = uint64(block.timestamp);
        r.value = value;
        if (id > latestDayId[regionId][perilType]) {
            latestDayId[regionId][perilType] = id;
        }

        emit DailyWeatherSubmitted(regionId, perilType, id, dayStart, value);
    }
}
