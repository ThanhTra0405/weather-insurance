// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LiquidityPool is Ownable, Pausable, ReentrancyGuard {
    uint256 totalDeposited;
    uint256 totalLocked;
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    address public addressPayoutEngine;
    event PayoutEngineSet(address indexed payoutEngine);
    address public addressPolicyManager;
    event LiquidityAdded(address indexed provider, uint256 amount);
    event LiquidityWithdrawn(address indexed provider, uint256 amount);
    event PolicyManagerSet(address indexed policyManager);
    constructor() Ownable(msg.sender) {}

    modifier onlyPolicyManager() {
        require(
            msg.sender == addressPolicyManager,
            "Khong phai la Policy Manager"
        );
        _;
    }

    modifier onlyPayoutEngine() {
        require(msg.sender == addressPayoutEngine, "Khong phai PayoutEngine");
        _;
    }

    mapping(uint256 => uint256) public lockedAmount;

    function setPolicyManager(address _policyManager) external onlyOwner {
        require(_policyManager != address(0), "PolicyManager la dia chi 0");
        require(
            addressPolicyManager == address(0),
            "PolicyManager da duoc set roi"
        );
        addressPolicyManager = _policyManager;
        emit PolicyManagerSet(_policyManager);
    }

    function availableLiquidity() external view returns (uint256) {
        return totalDeposited - totalLocked;
    }

    function lockCoverage(
        uint256 policyId,
        uint256 amount
    ) external onlyPolicyManager whenNotPaused {
        require(lockedAmount[policyId] == 0, "Policy da duoc khoa");
        require(amount <= totalDeposited - totalLocked, "Khong du eth");
        lockedAmount[policyId] = amount;
        totalLocked = totalLocked + amount;
    }

    function depositPremium() external payable onlyPolicyManager whenNotPaused {
        totalDeposited += msg.value;
    }

    function provideLiquidity() external payable whenNotPaused {
        require(msg.value > 0, "Khong co eth duoc gui vao");
        uint256 shares = totalShares == 0
            ? msg.value
            : (msg.value * totalShares) / totalDeposited;
        sharesOf[msg.sender] += shares;
        totalShares += shares;
        totalDeposited += msg.value;
        emit LiquidityAdded(msg.sender, msg.value);
    }

    function withdrawLiquidity(
        uint256 shareAmount
    ) external whenNotPaused nonReentrant {
        require(
            shareAmount > 0 && shareAmount <= sharesOf[msg.sender],
            "Khong du share"
        );
        uint256 amount = (shareAmount * totalDeposited) / totalShares;
        require(amount <= totalDeposited - totalLocked, "Vuot von kha dung");

        sharesOf[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalDeposited -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Gui eth that bai");
        emit LiquidityWithdrawn(msg.sender, amount);
    }

    function getPoolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setPayoutEngine(address _payoutEngine) external onlyOwner {
        require(_payoutEngine != address(0), "PayoutEngine la dia chi 0");
        require(
            addressPayoutEngine == address(0),
            "PayoutEngine da duoc set roi"
        );
        addressPayoutEngine = _payoutEngine;
        emit PayoutEngineSet(_payoutEngine);
    }

    function payOut(
        uint256 policyId,
        address recipient,
        uint256 amount
    ) external onlyPayoutEngine nonReentrant {
        require(lockedAmount[policyId] == amount, "So tien khong khop khoa");
        lockedAmount[policyId] = 0;
        totalLocked -= amount;
        totalDeposited -= amount;
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Gui eth that bai");
    }
}
