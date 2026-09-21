import { expect } from "chai";
import { network } from "hardhat";
import { deployAllFixture, PREMIUM, COVERAGE, THRESHOLD, DURATION_DAYS, VALID_LAT, VALID_LNG } from "../helpers/fixtures.js";
import { setWeatherBelowThreshold } from "../helpers/weather.js";
import { PERIL_DROUGHT } from "../helpers/perilType.js";

const { ethers, networkHelpers } = await network.connect();
const { loadFixture, time } = networkHelpers;

describe("FullFlow integration", function () {
    it("luong day du: LP gop von -> mua -> verify -> oracle -> payout", async function () {
        const { pool, policyManager, payoutEngine, oracle, owner, farmer, lp1, verifier } =
            await loadFixture(() => deployAllFixture(ethers));

        await pool.connect(lp1).provideLiquidity({ value: ethers.parseEther("10") });
        await policyManager.connect(owner).createPolicyProduct(
            "Han han", PERIL_DROUGHT, THRESHOLD, DURATION_DAYS, PREMIUM, COVERAGE
        );
        await policyManager.connect(farmer).buyPolicy(1n, VALID_LAT, VALID_LNG, { value: PREMIUM });

        let policy = await policyManager.getPolicy(1n);
        expect(policy.status).to.equal(0n);

        await policyManager.connect(verifier).verifyPolicy(1n, true);
        policy = await policyManager.getPolicy(1n);
        expect(policy.status).to.equal(1n);

        await setWeatherBelowThreshold(oracle, owner, policy.regionId, THRESHOLD, await time.latest());

        await expect(payoutEngine.checkAndPayout(1n))
            .to.emit(payoutEngine, "PayoutTriggered")
            .withArgs(1n, farmer.address, COVERAGE);

        policy = await policyManager.getPolicy(1n);
        expect(policy.status).to.equal(2n);
    });

    it("nhanh reject: verify tu choi -> khong payout duoc, premium hoan lai", async function () {
        const { pool, policyManager, payoutEngine, owner, farmer, lp1, verifier } =
            await loadFixture(() => deployAllFixture(ethers));

        await pool.connect(lp1).provideLiquidity({ value: ethers.parseEther("10") });
        await policyManager.connect(owner).createPolicyProduct(
            "Han han", PERIL_DROUGHT, THRESHOLD, DURATION_DAYS, PREMIUM, COVERAGE
        );
        await policyManager.connect(farmer).buyPolicy(1n, VALID_LAT, VALID_LNG, { value: PREMIUM });

        await expect(
            policyManager.connect(verifier).verifyPolicy(1n, false)
        ).to.changeEtherBalance(ethers, farmer, PREMIUM);

        await expect(payoutEngine.checkAndPayout(1n)).to.be.revertedWith(
            "Policy chua active hoac da dong"
        );
    });

    it("nhanh het han khong dat nguong: khong payout, premium thuoc pool", async function () {
        const { pool, policyManager, payoutEngine, owner, farmer, lp1, verifier } =
            await loadFixture(() => deployAllFixture(ethers));

        await pool.connect(lp1).provideLiquidity({ value: ethers.parseEther("10") });
        await policyManager.connect(owner).createPolicyProduct(
            "Han han", PERIL_DROUGHT, THRESHOLD, DURATION_DAYS, PREMIUM, COVERAGE
        );
        await policyManager.connect(farmer).buyPolicy(1n, VALID_LAT, VALID_LNG, { value: PREMIUM });
        await policyManager.connect(verifier).verifyPolicy(1n, true);

        await time.increase((DURATION_DAYS + 1) * 24 * 60 * 60);

        await expect(payoutEngine.checkAndPayout(1n)).to.be.revertedWith("Policy het han");

        const balanceAfter = await pool.getPoolBalance();
        expect(balanceAfter).to.be.gte(PREMIUM);
    });
});