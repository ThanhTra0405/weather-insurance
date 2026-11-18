// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Quy uoc "ngay du lieu" DUY NHAT cho Oracle, PolicyManager, PayoutEngine va Backend.
/// Ngay = ngay lich theo gio Viet Nam (UTC+7, khong co DST).
///   dayId    = (timestamp + 7h) / 1 ngay          (so ngay ke tu 1970-01-01 theo gio VN)
///   dayStart = dayId * 1 ngay - 7h                (timestamp cua 00:00 UTC+7 cua ngay do)
/// Backend phai dung dung cong thuc nay (xem OracleDay.cs).
library DayTime {
    uint256 internal constant OFFSET = 7 hours;

    function dayIdOf(uint256 ts) internal pure returns (uint256) {
        return (ts + OFFSET) / 1 days;
    }

    function dayStartOf(uint256 dayId) internal pure returns (uint256) {
        return dayId * 1 days - OFFSET;
    }

    function isDayStart(uint256 ts) internal pure returns (bool) {
        return (ts + OFFSET) % 1 days == 0;
    }

    /// Lam tron LEN moc 00:00 (UTC+7) gan nhat; neu ts da la 00:00 thi giu nguyen.
    function ceilToDayStart(uint256 ts) internal pure returns (uint256) {
        return dayStartOf((ts + OFFSET + 1 days - 1) / 1 days);
    }
}
