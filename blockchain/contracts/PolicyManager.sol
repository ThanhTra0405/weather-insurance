// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILiquidityPool {
    function availableLiquidity() external view returns (uint256);
    function lockCoverage(uint256 policyId, uint256 amount) external;
    function depositPremium() external payable;
}

contract PolicyManager is Ownable, Pausable, ReentrancyGuard {
    int256 private constant MIN_LAT = 8_180_000;
    int256 private constant MAX_LAT = 23_400_000;
    int256 private constant MIN_LNG = 102_140_000;
    int256 private constant MAX_LNG = 109_470_000;

    enum PolicyStatus {
        PendinVerification,
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

    ILiquidityPool public liquidityPool;

    uint256 public nextProductId = 1;
    uint256 public nextPolicyId = 1;

    mapping(uint256 => PolicyProduct) public products;
    mapping(uint256 => Policy) public policies;
    mapping(address => uint256[]) public policiesOf;

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

    constructor(address _liquidityPool) Ownable(msg.sender) {
        require(_liquidityPool != address(0), "pool = zero address");
        liquidityPool = ILiquidityPool(_liquidityPool);
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
        int256 lng,
        bytes32 regionId
    ) external payable whenNotPaused nonReentrant returns (uint256 policyId) {
        PolicyProduct memory p = products[productId];

        require(p.id != 0 && p.active, "San pham khong ton tai hoac ngung ban");
        require(lat >= MIN_LAT && lat <= MAX_LAT, "lat ngoai pham vi");
        require(lng >= MIN_LNG && lng <= MAX_LNG, "lng ngoai pham vi");
        require(regionId != bytes32(0), "regionId khong hop le");

        require(msg.value == p.premium, "Premium khong dung");

        require(
            liquidityPool.availableLiquidity() >= p.coverageAmount,
            "Pool khong du von"
        );

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
            status: PolicyStatus.PendinVerification
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
    }

    address public addressPayoutEngine;

    modifier onlyPayoutEngine() {
        require(msg.sender == addressPayoutEngine, "Khong phai PayoutEngine");
        _;
    }

    function setPayoutEngine(address _payoutEngine) external onlyOwner {
        require(addressPayoutEngine == address(0), "Da set roi");
        addressPayoutEngine = _payoutEngine;
    }

    function markPaidOut(uint256 policyId) external onlyPayoutEngine {
        policies[policyId].status = PolicyStatus.PaidOut;
        emit PayoutMarked(policyId);
    }
}