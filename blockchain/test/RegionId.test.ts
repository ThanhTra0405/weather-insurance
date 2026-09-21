import { expect } from "chai";
import { network } from "hardhat";
import { computeRegionId } from "./helpers/region.js";

const { ethers } = await network.connect();

describe("regionId JS vs on-chain", function () {
    it("khop 100% giua computeRegionId() JS va PolicyManager.computeRegionId() on-chain", async function () {
        const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
        const pool = await LiquidityPool.deploy();
        await pool.waitForDeployment();

        const PolicyManager = await ethers.getContractFactory("PolicyManager");
        const policyManager = await PolicyManager.deploy(await pool.getAddress());
        await policyManager.waitForDeployment();

        const vectors: Array<[number, number]> = [
            [10.0452, 105.7469],
            [21.0278, 105.8342],
            [10.2, 105.8],
            [10.099999, 105.699999],
        ];

        for (const [lat, lng] of vectors) {
            const jsResult = computeRegionId(lat, lng);
            const latScaled = BigInt(Math.round(lat * 1e6));
            const lngScaled = BigInt(Math.round(lng * 1e6));
            const onChainResult = await policyManager.computeRegionId(latScaled, lngScaled);
            expect(onChainResult).to.equal(jsResult);
        }
    });
});