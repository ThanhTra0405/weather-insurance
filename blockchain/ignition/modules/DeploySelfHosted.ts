import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Module dung cho Sepolia (va hardhat node local).
// Deployer (account 0) dong thoi la owner = verifier = oracle signer (1 key operator).
export default buildModule("DeploySelfHostedModule", (m) => {
    const operator = m.getAccount(0);

    const oracle = m.contract("SelfHostedOracle", [operator]);

    const pool = m.contract("LiquidityPool");
    const policyManager = m.contract("PolicyManager", [pool]);
    const payoutEngine = m.contract("PayoutEngine", [policyManager, pool, oracle]);

    m.call(pool, "setPolicyManager", [policyManager]);
    m.call(pool, "setPayoutEngine", [payoutEngine]);
    m.call(policyManager, "setPayoutEngine", [payoutEngine]);

    // Owner van qua duoc onlyVerifier, nhung set tuong minh de trang System hien dung verifier
    m.call(policyManager, "setVerifier", [operator]);

    return { oracle, pool, policyManager, payoutEngine };
});
