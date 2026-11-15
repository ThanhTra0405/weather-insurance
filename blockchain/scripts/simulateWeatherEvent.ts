import * as hardhat from "hardhat";
import assert from "node:assert/strict";

// Kich ban chay local, 3 peril: han han (0), lu (1), gio manh (2).
// Gia tri oracle nhan 100 (mm x 100, km/h x 100). Chay: npx hardhat run scripts/simulateWeatherEvent.ts
const hre: any = (hardhat as any).default ?? hardhat;

const COOLING = 3600; // giay
const DAY = 86400;
const STATUS = { Pending: 0n, Active: 1n, PaidOut: 2n, Closed: 3n };
const SCALE = 100;

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

  const [owner, lp, verifier, farmerA, farmerB, farmerC, farmerD, farmerE] =
    await ethers.getSigners();

  // ===== Deploy + noi quyen =====
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

  // threshold x100: han han < 150mm/30 ngay, lu > 150mm/3 ngay, gio > 60km/h
  await (await pm.createPolicyProduct("Han han", 0, 150 * SCALE, 90, PREMIUM, COVERAGE)).wait(); // id 1
  await (await pm.createPolicyProduct("Lu", 1, 150 * SCALE, 90, PREMIUM, COVERAGE)).wait(); // id 2
  await (await pm.createPolicyProduct("Gio manh", 2, 60 * SCALE, 90, PREMIUM, COVERAGE)).wait(); // id 3
  await assert.rejects(
    pm.createPolicyProduct("Han han ngan", 0, 150 * SCALE, 20, PREMIUM, COVERAGE),
    "Han han phai >= 30 ngay"
  );
  console.log("Deploy xong. Pool:", eth(await pool.availableLiquidity()), "ETH kha dung");

  // ===== Helpers =====
  async function buy(farmer: any, productId: number, lat: number, lng: number): Promise<bigint> {
    await (
      await pm.connect(farmer).buyPolicy(productId, BigInt(lat), BigInt(lng), { value: PREMIUM })
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

  const setWeather = async (region: string, peril: number, value: number) =>
    (await oracle.setWeatherData(region, peril, BigInt(Math.round(value * SCALE)), await latest())).wait();

  async function expectPayout(farmer: any, id: bigint, label: string) {
    assert.equal(await engine.isThresholdMet(id), true);
    const before: bigint = await provider.getBalance(farmer.address);
    await (await engine.checkAndPayout(id)).wait();
    const after: bigint = await provider.getBalance(farmer.address);
    assert.equal(after - before, COVERAGE);
    assert.equal(await statusOf(id), STATUS.PaidOut);
    console.log(`  - ${label}: nong dan nhan ${eth(after - before)} ETH, status = PaidOut`);
    await assert.rejects(engine.checkAndPayout(id));
    console.log("  - Goi payout lan 2: revert (dung)");
  }

  // Toa do (da scale 1e6)
  const CAN_THO = { lat: 10_045_200, lng: 105_746_900 };
  const HA_NOI = { lat: 21_028_500, lng: 105_804_800 };
  const HAI_PHONG = { lat: 20_844_900, lng: 106_688_100 };
  const DA_NANG = { lat: 16_054_400, lng: 108_202_200 };
  const HUE = { lat: 16_463_700, lng: 107_590_900 };

  // ===== [A] Han han: chi payout khi cua so 30 ngay nam trong thoi gian hieu luc =====
  console.log("\n[A] Han han: mua -> gui hash -> duyet -> mua thap");
  const idA = await buy(farmerA, 1, CAN_THO.lat, CAN_THO.lng);
  assert.equal(await statusOf(idA), STATUS.Pending);
  await submitAndVerify(farmerA, idA);
  assert.equal(await statusOf(idA), STATUS.Active);
  const regionA = await pm.computeRegionId(CAN_THO.lat, CAN_THO.lng);

  await setWeather(regionA, 0, 20); // 20mm < 150mm nhung dang trong cooling-off
  assert.equal(await engine.isThresholdMet(idA), false, "Trong cooling-off khong duoc payout");
  console.log("  - Trong cooling-off: chua du dieu kien (dung)");

  await increaseTime(COOLING + 60);
  await setWeather(regionA, 0, 20); // hieu luc nhung chua du 30 ngay
  assert.equal(await engine.isThresholdMet(idA), false, "Han han chua du cua so 30 ngay");
  console.log("  - Chua du 30 ngay ke tu hieu luc: chua payout (dung)");

  await increaseTime(30 * DAY + 60);
  await setWeather(regionA, 0, 20);
  await expectPayout(farmerA, idA, "Han han");

  // ===== [F] Lu: mua 3 ngay > 150mm =====
  console.log("\n[F] Lu: mua 3 ngay vuot nguong");
  const idF = await buy(farmerB, 2, HA_NOI.lat, HA_NOI.lng);
  await submitAndVerify(farmerB, idF);
  await increaseTime(COOLING + 60);
  const regionF = await pm.computeRegionId(HA_NOI.lat, HA_NOI.lng);
  await setWeather(regionF, 1, 100); // 100mm < 150mm
  assert.equal(await engine.isThresholdMet(idF), false);
  await assert.rejects(engine.checkAndPayout(idF));
  console.log("  - 100mm: chua dat nguong, payout bi tu choi (dung)");
  await setWeather(regionF, 1, 200); // 200mm > 150mm
  await expectPayout(farmerB, idF, "Lu");

  // ===== [W] Gio manh: gio giat > 60 km/h =====
  console.log("\n[W] Gio manh: gio giat vuot nguong");
  const idW = await buy(farmerC, 3, HAI_PHONG.lat, HAI_PHONG.lng);
  await submitAndVerify(farmerC, idW);
  await increaseTime(COOLING + 60);
  const regionW = await pm.computeRegionId(HAI_PHONG.lat, HAI_PHONG.lng);
  await setWeather(regionW, 2, 80); // 80 km/h > 60
  await expectPayout(farmerC, idW, "Gio manh");

  // ===== [P] Peril khac nhau cung vung khong lan du lieu =====
  console.log("\n[P] Du lieu oracle tach rieng theo peril");
  const idP = await buy(farmerD, 2, DA_NANG.lat, DA_NANG.lng); // lu
  await submitAndVerify(farmerD, idP);
  await increaseTime(COOLING + 60);
  const regionP = await pm.computeRegionId(DA_NANG.lat, DA_NANG.lng);
  await setWeather(regionP, 2, 100); // chi co du lieu GIO, khong co du lieu LU
  assert.equal(await engine.isThresholdMet(idP), false);
  console.log("  - Du lieu gio khong kich hoat bao hiem lu (dung)");

  // ===== [C] Mua nhung khong duoc duyet =====
  console.log("\n[C] Khong gui ho so / khong duoc duyet, het han -> hoan premium");
  const idC = await buy(farmerE, 3, HUE.lat, HUE.lng);
  assert.equal(await statusOf(idC), STATUS.Pending);

  // ===== Het han =====
  await assert.rejects(pm.expirePolicy(idP), "Chua het han thi khong duoc dong");
  await increaseTime(95 * DAY);

  const availBefore: bigint = await pool.availableLiquidity();
  await (await pm.expirePolicy(idP)).wait();
  const availAfterP: bigint = await pool.availableLiquidity();
  assert.equal(availAfterP - availBefore, COVERAGE);
  assert.equal(await statusOf(idP), STATUS.Closed);
  console.log(`  [P] expirePolicy: pool duoc mo khoa ${eth(availAfterP - availBefore)} ETH, status = Closed`);

  // Hoan premium phai chay duoc ke ca khi pool dang pause
  await (await pool.pause()).wait();
  const balC0: bigint = await provider.getBalance(farmerE.address);
  await (await pm.expirePolicy(idC)).wait();
  const balC1: bigint = await provider.getBalance(farmerE.address);
  assert.equal(balC1 - balC0, PREMIUM);
  assert.equal(await statusOf(idC), STATUS.Closed);
  console.log(`  [C] expirePolicy khi pool pause: hoan ${eth(balC1 - balC0)} ETH premium, status = Closed`);
  await (await pool.unpause()).wait();

  await assert.rejects(pm.expirePolicy(idA));
  console.log("  [A] expirePolicy tren policy da boi thuong: revert (dung)");

  const stats = await pool.getPoolStats();
  console.log("\ngetPoolStats:", stats.map((x: bigint) => eth(x)));

  console.log("\nTat ca kich ban dung.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
