
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployAllModule", (m) => {
  const backendSigner = m.getParameter("backendSigner");

  const oracle = m.contract("SelfHostedOracle", [backendSigner]);

  const pool = m.contract("LiquidityPool", [], {
    after: [oracle],
  });

  const policyManager = m.contract("PolicyManager", [pool], {
    after: [pool],
  });

  const payoutEngine = m.contract(
    "PayoutEngine",
    [policyManager, pool, oracle],
    { after: [policyManager] }
  );

  // Liên kết LiquidityPool với PolicyManager
  const c1 = m.call(pool, "setPolicyManager", [policyManager], {
    id: "pool_setPolicyManager",
    after: [payoutEngine],
  });

  // Liên kết LiquidityPool với PayoutEngine
  const c2 = m.call(pool, "setPayoutEngine", [payoutEngine], {
    id: "pool_setPayoutEngine",
    after: [c1],
  });

  // Liên kết PolicyManager với PayoutEngine
  const c3 = m.call(policyManager, "setPayoutEngine", [payoutEngine], {
    id: "pm_setPayoutEngine",
    after: [c2],
  });

  // Cấp quyền xác minh cho Backend Operator
  m.call(policyManager, "setVerifier", [backendSigner], {
    id: "pm_setVerifier",
    after: [c3],
  });

  return { oracle, pool, policyManager, payoutEngine };
});
