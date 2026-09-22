import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Dùng account #1 của Hardhat node làm backend signer (địa chỉ mặc định thứ 2
// trong danh sách account hiện ra khi chạy `npx hardhat node`)
const BACKEND_SIGNER_ADDRESS = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

export default buildModule("DeploySelfHostedModule", (m) => {
    const oracle = m.contract("SelfHostedOracle", [BACKEND_SIGNER_ADDRESS]);

    const pool = m.contract("LiquidityPool");
    const policyManager = m.contract("PolicyManager", [pool]);
    const payoutEngine = m.contract("PayoutEngine", [policyManager, pool, oracle]);

    m.call(pool, "setPolicyManager", [policyManager]);
    m.call(pool, "setPayoutEngine", [payoutEngine]);
    m.call(policyManager, "setPayoutEngine", [payoutEngine]);

    return { oracle, pool, policyManager, payoutEngine };
});