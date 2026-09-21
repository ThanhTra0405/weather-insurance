import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

const VALID_LAT = 10_045_000;
const VALID_LNG = 105_746_000;

describe("PolicyManager", function () {
    async function deployFixture() {
        const [owner, farmer, otherLp] = await ethers.getSigners();

        const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
        const pool = await LiquidityPool.deploy();
        await pool.waitForDeployment();

        const PolicyManager = await ethers.getContractFactory("PolicyManager");
        const policyManager = await PolicyManager.deploy(await pool.getAddress());

        await pool.connect(owner).setPolicyManager(await policyManager.getAddress());

        return { pool, policyManager, owner, farmer, otherLp };
    }

    async function withProductFixture() {
        const base = await deployFixture();
        const premium = ethers.parseEther("0.1");
        const coverage = ethers.parseEther("1");

        await base.policyManager.connect(base.owner).createPolicyProduct(
            "Han han Can Tho",
            0,          // perilType
            50,         // threshold (VD: 50mm)
            30,         // durationDays
            premium,
            coverage
        );

        return { ...base, premium, coverage, productId: 1n };
    }

    describe("createPolicyProduct", function () {
        it("chỉ owner mới tạo được sản phẩm", async function () {
            const { policyManager, farmer } = await deployFixture();

            await expect(
                policyManager.connect(farmer).createPolicyProduct(
                    "X", 0, 50, 30, ethers.parseEther("0.1"), ethers.parseEther("1")
                )
            ).to.be.revertedWithCustomError(policyManager, "OwnableUnauthorizedAccount");
        });
    });

    describe("buyPolicy", function () {
        it("mua thành công, trừ đúng premium, pool nhận đúng tiền", async function () {
            const { policyManager, pool, farmer, premium, coverage, productId } =
                await withProductFixture();

            await expect(
                policyManager.connect(farmer).buyPolicy(productId, VALID_LAT, VALID_LNG, {
                    value: premium,
                })
            ).to.changeEtherBalance(ethers, farmer, -premium);

            const policy = await policyManager.getPolicy(1);
            expect(policy.holder).to.equal(farmer.address);
            expect(policy.coverageAmount).to.equal(coverage);
        });

        it("revert nếu trả sai số premium", async function () {
            const { policyManager, farmer, productId } = await withProductFixture();

            await expect(
                policyManager.connect(farmer).buyPolicy(productId, VALID_LAT, VALID_LNG, {
                    value: ethers.parseEther("0.05"), // sai, đúng phải 0.1
                })
            ).to.be.revertedWith("Premium khong dung");
        });

        it("revert nếu toạ độ ngoài phạm vi Việt Nam", async function () {
            const { policyManager, farmer, premium, productId } = await withProductFixture();
            const invalidLat = 40_000_000; // ngoài lãnh thổ VN

            await expect(
                policyManager.connect(farmer).buyPolicy(productId, invalidLat, VALID_LNG, {
                    value: premium,
                })
            ).to.be.revertedWith("lat ngoai pham vi");
        });

        it("revert nếu đang pause", async function () {
            const { policyManager, owner, farmer, premium, productId } =
                await withProductFixture();

            await policyManager.connect(owner).pause();

            await expect(
                policyManager.connect(farmer).buyPolicy(productId, VALID_LAT, VALID_LNG, {
                    value: premium,
                })
            ).to.be.revertedWithCustomError(policyManager, "EnforcedPause");
        });

        it("revert nếu pool không đủ vốn khả dụng (solvency check)", async function () {
            const { policyManager, farmer, premium, productId } = await withProductFixture();

            await expect(
                policyManager.connect(farmer).buyPolicy(productId, VALID_LAT, VALID_LNG, {
                    value: premium,
                })
            ).to.be.revertedWith("Pool khong du von");
        });
    });

    describe("verifyPolicy", function () {
        async function pendingPolicyFixture() {
            const base = await withProductFixture();
            const [, , , verifierSigner] = await ethers.getSigners();

            await base.pool.connect(base.otherLp).provideLiquidity({ value: ethers.parseEther("10") });

            await base.policyManager.connect(base.owner).setVerifier(verifierSigner.address);
            await base.policyManager
                .connect(base.farmer)
                .buyPolicy(base.productId, VALID_LAT, VALID_LNG, { value: base.premium });
            return { ...base, verifierSigner, policyId: 1n };
        }

        it("verifier approve -> status chuyen Active", async function () {
            const { policyManager, verifierSigner, policyId } = await pendingPolicyFixture();

            await policyManager.connect(verifierSigner).verifyPolicy(policyId, true);
            const policy = await policyManager.getPolicy(policyId);
            expect(policy.status).to.equal(1n); // Active
        });

        it("verifier reject -> status Closed, hoan premium, unlock coverage", async function () {
            const { policyManager, pool, farmer, verifierSigner, policyId, premium } =
                await pendingPolicyFixture();

            await expect(
                policyManager.connect(verifierSigner).verifyPolicy(policyId, false)
            ).to.changeEtherBalance(ethers, farmer, premium);

            const policy = await policyManager.getPolicy(policyId);
            expect(policy.status).to.equal(3n); // Closed
            expect(await pool.lockedAmount(policyId)).to.equal(0n);
        });

        it("non-verifier goi verifyPolicy -> revert", async function () {
            const { policyManager, farmer, policyId } = await pendingPolicyFixture();
            await expect(
                policyManager.connect(farmer).verifyPolicy(policyId, true)
            ).to.be.revertedWith("Khong co quyen xac minh");
        });

        it("goi verifyPolicy 2 lan -> revert", async function () {
            const { policyManager, verifierSigner, policyId } = await pendingPolicyFixture();
            await policyManager.connect(verifierSigner).verifyPolicy(policyId, true);

            await expect(
                policyManager.connect(verifierSigner).verifyPolicy(policyId, true)
            ).to.be.revertedWith("Policy khong o trang thai cho xac minh");
        });

        it("setVerifier chi owner goi duoc", async function () {
            const { policyManager, farmer } = await withProductFixture();
            await expect(
                policyManager.connect(farmer).setVerifier(farmer.address)
            ).to.be.revertedWithCustomError(policyManager, "OwnableUnauthorizedAccount");
        });
    });
});