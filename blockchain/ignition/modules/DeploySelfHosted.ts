import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploy tuần tự từng tx một để tránh lỗi
// "in-flight transaction limit reached for delegated accounts".
export default buildModule("DeploySelfHostedModule", (m) => {
    const operator = m.getAccount(0);

    const oracle = m.contract("SelfHostedOracle", [operator]);

    const pool = m.contract("LiquidityPool", [], { after: [oracle] });

    const policyManager = m.contract("PolicyManager", [pool], { after: [pool] });

    const payoutEngine = m.contract(
        "PayoutEngine",
        [policyManager, pool, oracle],
        { after: [policyManager] }
    );

    const c1 = m.call(pool, "setPolicyManager", [policyManager], {
        id: "pool_setPolicyManager",
        after: [payoutEngine],
    });

    const c2 = m.call(pool, "setPayoutEngine", [payoutEngine], {
        id: "pool_setPayoutEngine",
        after: [c1],
    });

    const c3 = m.call(policyManager, "setPayoutEngine", [payoutEngine], {
        id: "pm_setPayoutEngine",
        after: [c2],
    });

    m.call(policyManager, "setVerifier", [operator], {
        id: "pm_setVerifier",
        after: [c3],
    });

    return { oracle, pool, policyManager, payoutEngine };
});