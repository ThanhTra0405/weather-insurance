import * as hardhat from "hardhat";
import fs from "node:fs";
import path from "node:path";

// Seed sau khi deploy:  npx hardhat run scripts/seedSepolia.ts --network sepolia
// (local: --network localhost). Chay lai nhieu lan van an toan (bo qua buoc da lam).
const hre: any = (hardhat as any).default ?? hardhat;

const SCALE = 100; // threshold x100
const COOLING_OFF_SECONDS = 60; // CAU HINH DEMO (ghi chu trong bao cao)
const LIQUIDITY_ETH = "0.3";

function findAddress(map: Record<string, string>, contract: string): string {
  const key = Object.keys(map).find((k) => k.endsWith(`#${contract}`));
  if (!key) throw new Error(`Khong tim thay ${contract} trong deployed_addresses.json`);
  return map[key];
}

async function main() {
  const conn: any =
    typeof hre.network?.connect === "function" ? await hre.network.connect() : hre;
  const ethers: any = conn.ethers;
  const provider: any = ethers.provider;

  const chainId = Number((await provider.getNetwork()).chainId);
  const file = path.resolve("ignition", "deployments", `chain-${chainId}`, "deployed_addresses.json");
  if (!fs.existsSync(file)) throw new Error(`Chua deploy: khong co ${file}`);
  const addrs: Record<string, string> = JSON.parse(fs.readFileSync(file, "utf8"));

  const policyManagerAddr = findAddress(addrs, "PolicyManager");
  const poolAddr = findAddress(addrs, "LiquidityPool");
  const engineAddr = findAddress(addrs, "PayoutEngine");
  const oracleAddr = findAddress(addrs, "SelfHostedOracle");

  const [operator] = await ethers.getSigners();
  const pm = await ethers.getContractAt("PolicyManager", policyManagerAddr, operator);
  const pool = await ethers.getContractAt("LiquidityPool", poolAddr, operator);
  const eth = (v: bigint) => ethers.formatEther(v);

  console.log(`Chain ${chainId}, operator ${operator.address}, so du ${eth(await provider.getBalance(operator.address))} ETH`);

  // 1. Cooling-off
  const cooling: bigint = await pm.coolingOffPeriod();
  if (cooling !== BigInt(COOLING_OFF_SECONDS)) {
    await (await pm.setCoolingOffPeriod(COOLING_OFF_SECONDS)).wait();
    console.log(`1. setCoolingOffPeriod(${COOLING_OFF_SECONDS}) xong (cau hinh demo)`);
  } else {
    console.log("1. Cooling-off da dung, bo qua");
  }

  // 2. Thanh khoan ban dau
  const [, deposited]: bigint[] = await pool.getPoolStats();
  if (deposited === 0n) {
    await (await pool.provideLiquidity({ value: ethers.parseEther(LIQUIDITY_ETH) })).wait();
    console.log(`2. provideLiquidity ${LIQUIDITY_ETH} ETH xong`);
  } else {
    console.log(`2. Pool da co ${eth(deposited)} ETH, bo qua`);
  }

  // 3. San pham (chi tao khi chua co san pham nao)
  const nextId: bigint = await pm.nextProductId();
  if (nextId <= 1n) {
    const premium = ethers.parseEther("0.001");
    const coverage = ethers.parseEther("0.01");
    const products: [string, number, number][] = [
      ["Bảo hiểm hạn hán", 0, 150 * SCALE], // < 150 mm / 30 ngay
      ["Bảo hiểm lũ", 1, 150 * SCALE], // > 150 mm / 3 ngay
      ["Bảo hiểm gió mạnh", 2, 60 * SCALE], // > 60 km/h
    ];
    for (const [name, peril, threshold] of products) {
      await (await pm.createPolicyProduct(name, peril, threshold, 90, premium, coverage)).wait();
      console.log(`3. Tao san pham: ${name}`);
    }
  } else {
    console.log(`3. Da co ${nextId - 1n} san pham, bo qua`);
  }

  // 4. Bang dia chi de dan vao config
  const startBlock = await provider.getBlockNumber();
  console.log("\n===== DIA CHI (dan vao 3 noi) =====");
  console.log(`PolicyManager     ${policyManagerAddr}`);
  console.log(`LiquidityPool     ${poolAddr}`);
  console.log(`PayoutEngine      ${engineAddr}`);
  console.log(`SelfHostedOracle  ${oracleAddr}`);
  console.log(`Block hien tai    ${startBlock}  (Indexer:StartBlock nen la block deploy PolicyManager, xem tren Etherscan)`);

  console.log("\n--- Backend (bien moi truong / user-secrets) ---");
  console.log(`Blockchain__ChainId=${chainId}`);
  console.log(`Blockchain__PolicyManagerAddress=${policyManagerAddr}`);
  console.log(`Blockchain__LiquidityPoolAddress=${poolAddr}`);
  console.log(`Blockchain__PayoutEngineAddress=${engineAddr}`);
  console.log(`Blockchain__SelfHostedOracleAddress=${oracleAddr}`);

  console.log("\n--- frontend environment.prod.ts ---");
  console.log(`  chainId: ${chainId},`);
  console.log(`  policyManagerAddress: '${policyManagerAddr}',`);
  console.log(`  liquidityPoolAddress: '${poolAddr}',`);
  console.log(`  payoutEngineAddress: '${engineAddr}',`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
