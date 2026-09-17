// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LiquidityPool is Ownable, Pausable, ReentrancyGuard {
    uint256 totalDeposited;
    uint256 totalLocked;

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

    mapping(uint256 => uint256) public lockedAmount;

    function setPolicyManager(address _policyManager) external onlyOwner {
        require(_policyManager != address(0), "PolicyManager la dia chi 0");
        require(addressPolicyManager == address(0), "PolicyManager da duoc set roi");
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
        totalDeposited += msg.value;
        emit LiquidityAdded(msg.sender, msg.value);
    }

        function withdrawLiquidity(uint256 amount) external whenNotPaused nonReentrant {
            require(amount > 0 && amount <= totalDeposited - totalLocked, "Khong du eth");
            totalDeposited -= amount;
            (bool success, ) = msg.sender.call{value: amount}(""); 
            require(success, "Gui eth that bai");
            emit LiquidityWithdrawn(msg.sender, amount);
        }

    function getPoolBalance() external view returns(uint256) {
        return address(this).balance;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
