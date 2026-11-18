// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./DailyWeatherStore.sol";

/// Oracle tu van hanh: Backend gui du lieu cua TUNG NGAY DA KET THUC.
/// - Moi (regionId, perilType, ngay) chi co 1 ban ghi; gui lai ngay da co se revert (khong ghi de).
/// - Ngay khong co du lieu thi KHONG co ban ghi (khong bao gio mac dinh = 0).
contract SelfHostedOracle is DailyWeatherStore, Ownable {
    // Cho phep backfill toi da 120 ngay ke tu ngay du lieu
    uint256 public constant MAX_BACKFILL_DAYS = 120;

    address public backendSigner;

    event BackendSignerSet(address indexed signer);

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

    /// dayStart = timestamp 00:00 UTC+7 cua ngay du lieu; ngay phai ket thuc truoc block.timestamp.
    function submitDailyData(
        bytes32 regionId,
        uint8 perilType,
        uint256 dayStart,
        uint256 value
    ) external onlyBackend {
        _storeDaily(regionId, perilType, dayStart, value, 1 days, MAX_BACKFILL_DAYS * 1 days);
    }

    /// Gui nhieu ngay 1 tx (backfill). Revert toan bo neu 1 ngay da co / khong hop le.
    function submitDailyDataBatch(
        bytes32 regionId,
        uint8 perilType,
        uint256[] calldata dayStarts,
        uint256[] calldata values
    ) external onlyBackend {
        require(dayStarts.length == values.length, "Do dai mang khong khop");
        require(dayStarts.length > 0 && dayStarts.length <= MAX_BATCH, "So ngay khong hop le");
        for (uint256 i = 0; i < dayStarts.length; i++) {
            _storeDaily(regionId, perilType, dayStarts[i], values[i], 1 days, MAX_BACKFILL_DAYS * 1 days);
        }
    }
}
