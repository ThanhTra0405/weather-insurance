import { network } from "hardhat";
import fs from "node:fs";

// Chay sau khi deploy:
//   npx hardhat ignition deploy ignition/modules/DeploySelfHosted.ts --network sepolia
//   npx hardhat run scripts/seedSepolia.ts --network sepolia
// (local: thay --network sepolia bang --network localhost)
const { ethers } = await network.connect();

const chainId = Number((await ethers.provider.getNetwork()).chainId);
const file = `ignition/deployments/chain-${chainId}/deployed_addresses.json`;
const addr: Record<string, string> = JSON.parse(fs.readFileSync(file, "utf8"));
const pick = (name: string): string => {
  const key = Object.keys(addr).find((k) => k.endsWith(`#${name}`));
  if (!key) throw new Error(`Khong thay ${name} trong ${file}`);
  return addr[key];
};

const pm = await ethers.getContractAt("PolicyManager", pick("PolicyManager"));
const pool = await ethers.getContractAt("LiquidityPool", pick("LiquidityPool"));

// Moi tx deu cho receipt de khoi loi nonce
await (await pm.setCoolingOffPeriod(60)).wait(); // 60 giay: cau hinh DEMO
console.log("Da set cooling-off = 60s");

await (await pool.provideLiquidity({ value: ethers.parseEther("0.3") })).wait();
console.log("Da gop 0.3 ETH vao pool");

// threshold nhan 100 (mm hoac km/h)
const products: [string, number, number][] = [
  ["Bao hiem han han", 0, 15000], // < 150 mm / 30 ngay
  ["Bao hiem lu", 1, 15000], //      > 150 mm / 3 ngay
  ["Bao hiem gio manh", 2, 6000], // > 60 km/h
];
for (const [name, peril, threshold] of products) {
  await (
    await pm.createPolicyProduct(
      name, peril, threshold, 90,
      ethers.parseEther("0.001"), ethers.parseEther("0.01")
    )
  ).wait();
  console.log("Da tao san pham:", name);
}

console.log("\nDia chi de dan vao config:");
console.table({
  "Blockchain:PolicyManagerAddress": pick("PolicyManager"),
  "Blockchain:LiquidityPoolAddress": pick("LiquidityPool"),
  "Blockchain:PayoutEngineAddress": pick("PayoutEngine"),
  "Blockchain:SelfHostedOracleAddress": pick("SelfHostedOracle"),
});
