import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploy toàn bộ hệ thống theo đúng thứ tự phụ thuộc:
// MockWeatherOracle -> LiquidityPool -> PolicyManager -> PayoutEngine
// rồi nối quyền chéo giữa các contract (setPolicyManager / setPayoutEngine).
export default buildModule("DeployAllModule", (m) => {
  // 1. Oracle không phụ thuộc contract nào khác -> deploy trước
  const oracle = m.contract("MockWeatherOracle");

  // 2. Pool không cần biết địa chỉ PolicyManager lúc deploy (set sau qua setPolicyManager)
  const pool = m.contract("LiquidityPool");

  // 3. PolicyManager cần địa chỉ pool ngay từ constructor
  const policyManager = m.contract("PolicyManager", [pool]);

  // 4. PayoutEngine cần cả 3 địa chỉ trên
  const payoutEngine = m.contract("PayoutEngine", [policyManager, pool, oracle]);

  // ==== Nối quyền chéo — bắt buộc, nếu thiếu bước nào hệ thống sẽ revert khi chạy thật ====

  // Pool phải biết PolicyManager thật để cho phép lockCoverage/depositPremium/refundAndUnlock
  m.call(pool, "setPolicyManager", [policyManager]);

  // Pool phải biết PayoutEngine thật để cho phép payOut (chỉ nó được rút tiền pool)
  m.call(pool, "setPayoutEngine", [payoutEngine]);

  // PolicyManager phải biết PayoutEngine thật để cho phép markPaidOut
  m.call(policyManager, "setPayoutEngine", [payoutEngine]);

  return { oracle, pool, policyManager, payoutEngine };
});