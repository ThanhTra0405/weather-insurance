// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Oracle luu lich su theo (regionId, perilType, ngay). Moi ngay toi da 1 ban ghi, khong ghi de.
/// Don vi value (x100): 0 han han = mua NGAY (mm x100); 1 lu = tong mua 3 ngay ket thuc o ngay do (mm x100);
/// 2 gio manh = gio giat manh nhat 3 ngay ket thuc o ngay do (km/h x100).
interface IWeatherOracle {
    /// Ban ghi cua ngay MOI NHAT co du lieu: (value, dayStart cua ngay do). (0,0) neu chua co.
    function getWeatherData(bytes32 regionId, uint8 perilType)
        external view returns (uint256 value, uint256 timestamp);

    /// dayId moi nhat co du lieu (0 = chua co).
    function latestDayId(bytes32 regionId, uint8 perilType) external view returns (uint256);

    /// Ban ghi cua dung 1 ngay; dayStart phai la 00:00 UTC+7.
    function getDailyData(bytes32 regionId, uint8 perilType, uint256 dayStart)
        external view returns (bool exists, uint256 value);

    /// Tong value cua dayCount ngay lien tiep bat dau tu fromDayStart.
    /// present = so ngay CO ban ghi. Ngay thieu KHONG duoc tinh la 0, caller phai kiem tra present == dayCount.
    function sumDailyRange(bytes32 regionId, uint8 perilType, uint256 fromDayStart, uint256 dayCount)
        external view returns (uint256 total, uint256 present);
}
