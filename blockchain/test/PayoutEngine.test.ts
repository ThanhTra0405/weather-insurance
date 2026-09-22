import { expect } from "chai";
import { network } from "hardhat";
import { deployAllFixture, seedLiquidityFixture, withActivePolicyFixture, PREMIUM } from "./helpers/fixtures.js";
import { setWeatherBelowThreshold, setWeatherAboveThreshold, setWeatherStale } from "./helpers/weather.js";
import { PERIL_DROUGHT, PERIL_FLOOD } from "./helpers/perilType.js";

const { ethers, networkHelpers } = await network.connect();
const { loadFixture, time } = networkHelpers;

async function fixtureSeedLiquidity() {
    return seedLiquidityFixture(ethers);
}

async function fixtureActivePolicy() {
    return withActivePolicyFixture(ethers);
}

async function nowTs(): Promise<number> {
    return time.latest();
}

describe("PayoutEngine", function () {
    describe("checkAndPayout", function () {
        it("revert neu policy chua verify (PendingVerification)", async function () {
            const base = await loadFixture(fixtureSeedLiquidity);
            await base.policyManager.connect(base.owner).createPolicyProduct(
                "Test", PERIL_DROUGHT, 50, 30, PREMIUM, ethers.parseEther("1")
            );
            await base.policyManager
                .connect(base.farmer)
                .buyPolicy(1n, 10_045_000n, 105_746_000n, { value: PREMIUM });

            await expect(base.payoutEngine.checkAndPayout(1n)).to.be.revertedWith(
                "Policy chua active hoac da dong"
            );
        });

        it("revert neu policy da het han", async function () {
            const { payoutEngine, policyId } = await loadFixture(fixtureActivePolicy);
            await time.increase(31 * 24 * 60 * 60);

            await expect(payoutEngine.checkAndPayout(policyId)).to.be.revertedWith("Policy het han");
        });

        it("revert neu du lieu oracle cu hon startTime", async function () {
            const { payoutEngine, oracle, owner, policyId, regionId, threshold } =
                await loadFixture(fixtureActivePolicy);

            await setWeatherStale(oracle, owner, regionId, threshold - 1n, 1);
            await expect(payoutEngine.checkAndPayout(policyId)).to.be.revertedWith("Du lieu qua cu");
        });

        it("revert neu chua dat nguong", async function () {
            const { payoutEngine, oracle, owner, policyId, regionId, threshold } =
                await loadFixture(fixtureActivePolicy);

            await setWeatherAboveThreshold(oracle, owner, regionId, threshold, await nowTs());
            await expect(payoutEngine.checkAndPayout(policyId)).to.be.revertedWith("Chua dat nguong");
        });

        it("payout dung: chuyen dung coverageAmount, status chuyen PaidOut", async function () {
            const { payoutEngine, policyManager, oracle, owner, farmer, policyId, regionId, threshold, coverage } =
                await loadFixture(fixtureActivePolicy);

            await setWeatherBelowThreshold(oracle, owner, regionId, threshold, await nowTs());

            await expect(payoutEngine.checkAndPayout(policyId)).to.changeEtherBalance(ethers, farmer, coverage);

            const policy = await policyManager.getPolicy(policyId);
            expect(policy.status).to.equal(2n);
        });

        it("revert neu goi checkAndPayout 2 lan cho cung policy", async function () {
            const { payoutEngine, oracle, owner, policyId, regionId, threshold } =
                await loadFixture(fixtureActivePolicy);

            await setWeatherBelowThreshold(oracle, owner, regionId, threshold, await nowTs());
            await payoutEngine.checkAndPayout(policyId);

            await expect(payoutEngine.checkAndPayout(policyId)).to.be.revertedWith(
                "Policy chua active hoac da dong"
            );
        });
    });

    describe("perilType", function () {
        it("DROUGHT: payout khi value < threshold", async function () {
            const { payoutEngine, oracle, owner, policyId, regionId, threshold } =
                await loadFixture(fixtureActivePolicy);
            await setWeatherBelowThreshold(oracle, owner, regionId, threshold, await nowTs());
            await expect(payoutEngine.checkAndPayout(policyId)).to.not.revert(ethers);
        });

        it("FLOOD: payout khi value > threshold", async function () {
            const base = await loadFixture(fixtureSeedLiquidity);
            await base.policyManager.connect(base.owner).createPolicyProduct(
                "Lu Can Tho", PERIL_FLOOD, 50, 30, PREMIUM, ethers.parseEther("1")
            );
            await base.policyManager
                .connect(base.farmer)
                .buyPolicy(1n, 10_045_000n, 105_746_000n, { value: PREMIUM });
            await base.policyManager.connect(base.verifier).verifyPolicy(1n, true);

            const policy = await base.policyManager.getPolicy(1n);
            await setWeatherAboveThreshold(base.oracle, base.owner, policy.regionId, 50n, await nowTs());

            await expect(base.payoutEngine.checkAndPayout(1n)).to.not.revert(ethers);
        });
    });
});