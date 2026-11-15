// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILiquidityPool {
    function availableLiquidity() external view returns (uint256);
    function lockCoverage(uint256 policyId, uint256 amount) external;
    function depositPremium() external payable;
    function unlockCoverage(uint256 policyId) external;
    function refundAndUnlock(
        uint256 policyId,
        address to,
        uint256 amount
    ) external;
}

contract PolicyManager is Ownable, Pausable, ReentrancyGuard {
    int256 private constant MIN_LAT = 8_180_000;
    int256 private constant MAX_LAT = 23_400_000;
    int256 private constant MIN_LNG = 102_140_000;
    int256 private constant MAX_LNG = 109_470_000;

    // gridSizeDeg = 0.2 độ, đã scale 1e6 -> 200_000, khớp region.md
    int256 private constant GRID_SIZE_SCALED = 200_000;

    enum PolicyStatus {
        PendingVerification,
        Active,
        PaidOut,
        Closed
    }

    struct PolicyProduct {
        uint256 id;
        string name;
        uint8 perilType;
        uint256 threshold;
        uint256 durationDays;
        uint256 premium;
        uint256 coverageAmount;
        bool active;
    }

    struct Policy {
        uint256 id;
        uint256 productId;
        address holder;
        int256 lat;
        int256 lng;
        bytes32 regionId;
        uint256 startTime;
        uint256 endTime;
        uint256 premiumPaid;
        uint256 coverageAmount;
        PolicyStatus status;
    }

    // Bằng chứng xác minh: chỉ lưu hash, ảnh gốc nằm off-chain
    struct Evidence {
        bytes32 fieldPhotoHash;
        bytes32 documentHash;
        uint256 submittedAt;
    }

    ILiquidityPool public liquidityPool;
    address public verifier;
    address public addressPayoutEngine;

    uint256 public nextProductId = 1;
    uint256 public nextPolicyId = 1;

    uint256 public coolingOffPeriod;

    mapping(uint256 => PolicyProduct) public products;
    mapping(uint256 => Policy) public policies;
    mapping(address => uint256[]) public policiesOf;
    mapping(uint256 => Evidence) public evidenceOf;

    event CoolingOffPeriodSet(uint256 seconds_);
    event PolicyProductCreated(
        uint256 indexed productId,
        string name,
        uint256 premium,
        uint256 coverageAmount
    );
    event PolicyCreated(
        uint256 indexed policyId,
        uint256 indexed productId,
        address indexed holder,
        int256 lat,
        int256 lng,
        bytes32 regionId,
        uint256 premiumPaid,
        uint256 coverageAmount,
        uint256 endTime
    );
    event ProductStatusChanged(uint256 id, bool active);
    event PayoutMarked(uint256 indexed policyId);
    event EvidenceSubmitted(
        uint256 indexed policyId,
        bytes32 fieldPhotoHash,
        bytes32 documentHash
    );
    event PolicyVerified(uint256 indexed policyId, bool approved);
    event PolicyExpired(uint256 indexed policyId, bool refunded);
    event VerifierSet(address indexed verifier);
    event LiquidityPoolSet(address indexed pool);
    event PayoutEngineSet(address indexed payoutEngine);

    modifier onlyPayoutEngine() {
        require(msg.sender == addressPayoutEngine, "Khong phai PayoutEngine");
        _;
    }

    modifier onlyVerifier() {
        require(
            msg.sender == verifier || msg.sender == owner(),
            "Khong co quyen xac minh"
        );
        _;
    }

    constructor(address _liquidityPool) Ownable(msg.sender) {
        require(_liquidityPool != address(0), "pool = zero address");
        liquidityPool = ILiquidityPool(_liquidityPool);
    }

    // regionId tính ON-CHAIN, làm tròn về lưới 0.2 độ, pack (lat,lng), keccak256.
    // Chỉ hỗ trợ toạ độ dương (đúng scope đồ án — lãnh thổ VN có lat/lng dương).
    function computeRegionId(
        int256 lat,
        int256 lng
    ) public pure returns (bytes32) {
        int256 roundedLat = _roundToGrid(lat);
        int256 roundedLng = _roundToGrid(lng);
        return keccak256(abi.encodePacked(roundedLat, roundedLng));
    }

    function _roundToGrid(int256 scaledValue) private pure returns (int256) {
        require(scaledValue >= 0, "chi ho tro toa do duong");
        int256 half = GRID_SIZE_SCALED / 2;
        return ((scaledValue + half) / GRID_SIZE_SCALED) * GRID_SIZE_SCALED;
    }

    function createPolicyProduct(
        string calldata name,
        uint8 perilType,
        uint256 threshold,
        uint256 durationDays,
        uint256 premium,
        uint256 coverageAmount
    ) external onlyOwner whenNotPaused returns (uint256 productId) {
        require(bytes(name).length > 0, "ten rong");
        require(perilType <= 2, "peril khong hop le");
        require(threshold > 0, "threshold phai lon hon 0");
        require(
            durationDays > 0 && durationDays <= 365,
            "thoi gian khong hop le"
        );
        if (perilType == 0) {
            require(durationDays >= 30, "han han can it nhat 30 ngay");
        }
        require(premium > 0, "phi phai dong lon hon 0");
        require(
            coverageAmount > premium,
            "so tien boi thuong phai lon hon phi phai dong"
        );

        productId = nextProductId++;
        products[productId] = PolicyProduct({
            id: productId,
            name: name,
            perilType: perilType,
            threshold: threshold,
            durationDays: durationDays,
            premium: premium,
            coverageAmount: coverageAmount,
            active: true
        });

        emit PolicyProductCreated(productId, name, premium, coverageAmount);
    }

    function buyPolicy(
        uint256 productId,
        int256 lat,
        int256 lng
    ) external payable whenNotPaused nonReentrant returns (uint256 policyId) {
        PolicyProduct memory p = products[productId];

        require(p.id != 0 && p.active, "San pham khong ton tai hoac ngung ban");
        require(lat >= MIN_LAT && lat <= MAX_LAT, "lat ngoai pham vi");
        require(lng >= MIN_LNG && lng <= MAX_LNG, "lng ngoai pham vi");
        require(msg.value == p.premium, "Premium khong dung");
        require(
            liquidityPool.availableLiquidity() >= p.coverageAmount,
            "Pool khong du von"
        );

        bytes32 regionId = computeRegionId(lat, lng);

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            id: policyId,
            productId: productId,
            holder: msg.sender,
            lat: lat,
            lng: lng,
            regionId: regionId,
            startTime: block.timestamp,
            endTime: block.timestamp + p.durationDays * 1 days,
            premiumPaid: msg.value,
            coverageAmount: p.coverageAmount,
            status: PolicyStatus.PendingVerification
        });
        policiesOf[msg.sender].push(policyId);

        liquidityPool.lockCoverage(policyId, p.coverageAmount);
        liquidityPool.depositPremium{value: msg.value}();

        emit PolicyCreated(
            policyId,
            productId,
            msg.sender,
            lat,
            lng,
            regionId,
            msg.value,
            p.coverageAmount,
            block.timestamp + p.durationDays * 1 days
        );
    }

    // ===== Xác minh =====

    // Chủ policy gửi hash ảnh ruộng + ảnh giấy tờ (ảnh gốc lưu ở backend)
    function submitVerificationEvidence(
        uint256 policyId,
        bytes32 fieldPhotoHash,
        bytes32 documentHash
    ) external whenNotPaused {
        Policy storage pol = policies[policyId];
        require(pol.id != 0, "Policy khong ton tai");
        require(msg.sender == pol.holder, "Chi chu policy moi duoc gui");
        require(
            pol.status == PolicyStatus.PendingVerification,
            "Policy khong o trang thai cho xac minh"
        );
        require(
            evidenceOf[policyId].submittedAt == 0,
            "Da gui bang chung roi"
        );
        require(
            fieldPhotoHash != bytes32(0) && documentHash != bytes32(0),
            "Hash rong"
        );

        evidenceOf[policyId] = Evidence({
            fieldPhotoHash: fieldPhotoHash,
            documentHash: documentHash,
            submittedAt: block.timestamp
        });

        emit EvidenceSubmitted(policyId, fieldPhotoHash, documentHash);
    }

    function verifyPolicy(
        uint256 policyId,
        bool approved
    ) external onlyVerifier whenNotPaused nonReentrant {
        Policy storage pol = policies[policyId];
        require(pol.id != 0, "Policy khong ton tai");
        require(
            pol.status == PolicyStatus.PendingVerification,
            "Policy khong o trang thai cho xac minh"
        );

        if (approved) {
            require(
                evidenceOf[policyId].submittedAt != 0,
                "Chua co bang chung"
            );
            // Cooling-off: hiệu lực sau coolingOffPeriod kể từ lúc duyệt,
            // thời hạn bảo hiểm tính lại từ mốc đó
            pol.status = PolicyStatus.Active;
            pol.startTime = block.timestamp + coolingOffPeriod;
            pol.endTime =
                pol.startTime +
                products[pol.productId].durationDays *
                1 days;
        } else {
            pol.status = PolicyStatus.Closed;
            uint256 refund = pol.premiumPaid;
            pol.premiumPaid = 0;
            liquidityPool.refundAndUnlock(policyId, pol.holder, refund);
        }

        emit PolicyVerified(policyId, approved);
    }

    // Bất kỳ ai (keeper/cron) gọi được sau khi policy hết hạn:
    // - Active: đóng policy, mở khoá coverage, premium thuộc về pool
    // - Chưa được duyệt: hoàn premium cho chủ policy + mở khoá coverage
    function expirePolicy(uint256 policyId) external nonReentrant {
        Policy storage pol = policies[policyId];
        require(pol.id != 0, "Policy khong ton tai");
        require(block.timestamp > pol.endTime, "Policy chua het han");

        bool refunded;
        if (pol.status == PolicyStatus.Active) {
            pol.status = PolicyStatus.Closed;
            liquidityPool.unlockCoverage(policyId);
        } else if (pol.status == PolicyStatus.PendingVerification) {
            pol.status = PolicyStatus.Closed;
            uint256 refund = pol.premiumPaid;
            pol.premiumPaid = 0;
            liquidityPool.refundAndUnlock(policyId, pol.holder, refund);
            refunded = true;
        } else {
            revert("Policy da dong hoac da boi thuong");
        }

        emit PolicyExpired(policyId, refunded);
    }

    function setVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "verifier = zero address");
        verifier = _verifier;
        emit VerifierSet(_verifier);
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        require(policies[policyId].id != 0, "Policy khong ton tai");
        return policies[policyId];
    }

    function getPoliciesOf(
        address holder
    ) external view returns (uint256[] memory) {
        return policiesOf[holder];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setProductActive(
        uint256 productId,
        bool active
    ) external onlyOwner {
        require(products[productId].id != 0, "Product khong ton tai");
        products[productId].active = active;
        emit ProductStatusChanged(
            products[productId].id,
            products[productId].active
        );
    }

    function setLiquidityPool(address newPool) external onlyOwner whenPaused {
        require(newPool != address(0), "Pool khong ton tai");
        liquidityPool = ILiquidityPool(newPool);
        emit LiquidityPoolSet(newPool);
    }

    function setPayoutEngine(address _payoutEngine) external onlyOwner {
        require(addressPayoutEngine == address(0), "Da set roi");
        addressPayoutEngine = _payoutEngine;
        emit PayoutEngineSet(_payoutEngine);
    }

    function markPaidOut(uint256 policyId) external onlyPayoutEngine {
        policies[policyId].status = PolicyStatus.PaidOut;
        emit PayoutMarked(policyId);
    }

    function setCoolingOffPeriod(uint256 seconds_) external onlyOwner {
        coolingOffPeriod = seconds_;
        emit CoolingOffPeriodSet(seconds_);
    }
}