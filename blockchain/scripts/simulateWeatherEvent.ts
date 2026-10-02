import * as hardhat from "hardhat";
import assert from "node:assert/strict";

// Tương thích Hardhat 2 (hre có sẵn ethers) và Hardhat 3 (phải network.connect())
const hre: any = (hardhat as any).default ?? hardhat;

const COOLING = 3600; // giây
const DAY = 86400;
const THRESHOLD = 50; // mm mưa / 30 ngày (hạn hán: value < threshold)
const STATUS = { Pending: 0n, Active: 1n, PaidOut: 2n, Closed: 3n };

async function main() {
  const conn: any =
    typeof hre.network?.connect === "function" ? await hre.network.connect() : hre;
  const ethers: any = conn.ethers;
  const provider: any = ethers.provider;

  const PREMIUM = ethers.parseEther("0.1");
  const COVERAGE = ethers.parseEther("1");
  const eth = (v: bigint) => ethers.formatEther(v);

  const latest = async (): Promise<number> =>
    Number((await provider.getBlock("latest")).timestamp);
  const increaseTime = async (seconds: number) => {
    await provider.send("evm_increaseTime", [seconds]);
    await provider.send("evm_mine", []);
  };

  async function deploy(name: string, ...args: any[]): Promise<any> {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    return c;
  }

  const [owner, lp, verifier, farmerA, farmerB, farmerC] = await ethers.getSigners();

  // ===== Deploy + nối quyền =====
  const oracle = await deploy("MockWeatherOracle");
  const pool = await deploy("LiquidityPool");
  const pm = await deploy("PolicyManager", await pool.getAddress());
  const engine = await deploy(
    "PayoutEngine",
    await pm.getAddress(),
    await pool.getAddress(),
    await oracle.getAddress()
  );

  await (await pool.setPolicyManager(await pm.getAddress())).wait();
  await (await pool.setPayoutEngine(await engine.getAddress())).wait();
  await (await pm.setPayoutEngine(await engine.getAddress())).wait();
  await (await pm.setVerifier(verifier.address)).wait();
  await (await pm.setCoolingOffPeriod(COOLING)).wait();

  await (await pool.connect(lp).provideLiquidity({ value: ethers.parseEther("10") })).wait();
  await (await pm.createPolicyProduct("Han han Can Tho", 0, THRESHOLD, 30, PREMIUM, COVERAGE)).wait();
  console.log("Deploy xong. Pool:", eth(await pool.availableLiquidity()), "ETH kha dung");

  // ===== Helpers =====
  async function buy(farmer: any, lat: number, lng: number): Promise<bigint> {
    await (
      await pm.connect(farmer).buyPolicy(1, BigInt(lat), BigInt(lng), { value: PREMIUM })
    ).wait();
    const ids: bigint[] = await pm.getPoliciesOf(farmer.address);
    return ids[ids.length - 1];
  }

  async function submitAndVerify(farmer: any, id: bigint) {
    await (
      await pm
        .connect(farmer)
        .submitVerificationEvidence(id, ethers.id(`field-${id}`), ethers.id(`doc-${id}`))
    ).wait();
    await (await pm.connect(verifier).verifyPolicy(id, true)).wait();
  }

  const statusOf = async (id: bigint): Promise<bigint> =>
    BigInt((await pm.getPolicy(id)).status);

  // Toạ độ (đã scale 1e6)
  const CAN_THO = { lat: 10_045_200, lng: 105_746_900 };
  const HA_NOI = { lat: 21_028_500, lng: 105_804_800 };
  const HAI_PHONG = { lat: 20_844_900, lng: 106_688_100 };

  // ===== Kịch bản A: đạt ngưỡng -> payout =====
  console.log("\n[A] Han han, mua -> gui hash -> duyet -> mua thap -> payout");
  const idA = await buy(farmerA, CAN_THO.lat, CAN_THO.lng);
  assert.equal(await statusOf(idA), STATUS.Pending);
  await submitAndVerify(farmerA, idA);
  assert.equal(await statusOf(idA), STATUS.Active);

  // Chưa qua cooling-off: dữ liệu oracle lúc này phải bị bỏ qua
  const regionA = await pm.computeRegionId(CAN_THO.lat, CAN_THO.lng);
  await (await oracle.setWeatherData(regionA, 20, await latest())).wait();
  assert.equal(await engine.isThresholdMet(idA), false, "Trong cooling-off khong duoc payout");
  console.log("  - Trong cooling-off: chua du dieu kien (dung)");

  await increaseTime(COOLING + 60);
  await (await oracle.setWeatherData(regionA, 20, await latest())).wait(); // 20mm < 50mm
  assert.equal(await engine.isThresholdMet(idA), true);

  const beforeA: bigint = await provider.getBalance(farmerA.address);
  await (await engine.checkAndPayout(idA)).wait();
  const afterA: bigint = await provider.getBalance(farmerA.address);
  assert.equal(afterA - beforeA, COVERAGE);
  assert.equal(await statusOf(idA), STATUS.PaidOut);
  console.log(`  - Nong dan nhan ${eth(afterA - beforeA)} ETH, status = PaidOut`);

  await assert.rejects(engine.checkAndPayout(idA));
  console.log("  - Goi payout lan 2: revert (dung)");

  // ===== Kịch bản B: đã duyệt nhưng không đạt ngưỡng =====
  console.log("\n[B] Da duyet, khong dat nguong, het han -> mo khoa coverage");
  const idB = await buy(farmerB, HA_NOI.lat, HA_NOI.lng);
  await submitAndVerify(farmerB, idB);
  await increaseTime(COOLING + 60);
  const regionB = await pm.computeRegionId(HA_NOI.lat, HA_NOI.lng);
  await (await oracle.setWeatherData(regionB, 100, await latest())).wait(); // 100mm >= 50mm
  assert.equal(await engine.isThresholdMet(idB), false);
  await assert.rejects(engine.checkAndPayout(idB));
  console.log("  - Mua 100mm: khong dat nguong, payout bi tu choi (dung)");

  // ===== Kịch bản C: mua nhưng không được duyệt =====
  console.log("\n[C] Khong gui ho so / khong duoc duyet, het han -> hoan premium");
  const idC = await buy(farmerC, HAI_PHONG.lat, HAI_PHONG.lng);
  assert.equal(await statusOf(idC), STATUS.Pending);

  // ===== Hết hạn tất cả =====
  await assert.rejects(pm.expirePolicy(idB), "Chua het han thi khong duoc dong");
  await increaseTime(31 * DAY + COOLING + 100);

  const availBefore: bigint = await pool.availableLiquidity();
  await (await pm.expirePolicy(idB)).wait();
  const availAfterB: bigint = await pool.availableLiquidity();
  assert.equal(availAfterB - availBefore, COVERAGE);
  assert.equal(await statusOf(idB), STATUS.Closed);
  console.log(`  [B] expirePolicy: pool duoc mo khoa ${eth(availAfterB - availBefore)} ETH, status = Closed`);

  const balC0: bigint = await provider.getBalance(farmerC.address);
  await (await pm.expirePolicy(idC)).wait(); // owner gọi nên nông dân C không mất gas
  const balC1: bigint = await provider.getBalance(farmerC.address);
  assert.equal(balC1 - balC0, PREMIUM);
  assert.equal(await statusOf(idC), STATUS.Closed);
  console.log(`  [C] expirePolicy: hoan ${eth(balC1 - balC0)} ETH premium, status = Closed`);

  await assert.rejects(pm.expirePolicy(idA));
  console.log("  [A] expirePolicy tren policy da boi thuong: revert (dung)");

  console.log("\nTat ca kich ban dung.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});