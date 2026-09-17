import { expect } from "chai";
import { network } from "hardhat";
import { LiquidityPool__factory } from "../types/ethers-contracts/index.js";
const { ethers } = await network.connect();

describe("LiquidityPool", function () {
    // Fixture: deploy lại contract sạch cho MỖI test case, tránh test này ảnh hưởng test kia
    async function deployFixture() {
        const [owner, fakePolicyManager, lp1, lp2] = await ethers.getSigners();

        // Dùng 1 địa chỉ signer thường (fakePolicyManager) giả làm PolicyManager
        // vì LiquidityPool chỉ cần ĐỊA CHỈ đúng để pass onlyPolicyManager,
        // không quan tâm địa chỉ đó có phải contract PolicyManager thật hay không
        const LiquidityPool = new LiquidityPool__factory(owner);

        const pool = await LiquidityPool.deploy();
        await pool.waitForDeployment();

        await pool.setPolicyManager(fakePolicyManager.address);

        return { pool, owner, fakePolicyManager, lp1, lp2 };
    }

    describe("provideLiquidity", function () {
        it("cộng đúng số dư khi LP góp vốn", async function () {
            const { pool, lp1 } = await deployFixture();
            const amount = ethers.parseEther("1"); // 1 ETH -> wei

            await pool.connect(lp1).provideLiquidity({ value: amount });

            expect(await pool.availableLiquidity()).to.equal(amount);
            expect(await pool.getPoolBalance()).to.equal(amount);
        });

        it("revert nếu gửi 0 ETH", async function () {
            const { pool, lp1 } = await deployFixture();

            await expect(
                pool.connect(lp1).provideLiquidity({ value: 0 })
            ).to.be.revertedWith("Khong co eth duoc gui vao");
        });

        it("revert nếu contract đang pause", async function () {
            const { pool, owner, lp1 } = await deployFixture();
            await pool.connect(owner).pause();

            await expect(
                pool.connect(lp1).provideLiquidity({ value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(pool, "EnforcedPause");
        });
    });

    describe("withdrawLiquidity", function () {
        it("trừ đúng số dư và chuyển ETH về đúng người rút", async function () {
            const { pool, lp1 } = await deployFixture();
            const deposit = ethers.parseEther("2");
            const withdraw = ethers.parseEther("0.5");

            await pool.connect(lp1).provideLiquidity({ value: deposit });

            // changeEtherBalance tự check số dư VÍ lp1 tăng đúng "withdraw",
            // đã trừ sẵn phần gas họ phải trả cho chính transaction rút này
            await expect(
                pool.connect(lp1).withdrawLiquidity(withdraw)
            ).to.changeEtherBalance(ethers, lp1, withdraw);

            expect(await pool.availableLiquidity()).to.equal(deposit - withdraw);
        });

        it("revert nếu rút vượt phần available (đã bị khoá bởi lockCoverage)", async function () {
            const { pool, fakePolicyManager, lp1 } = await deployFixture();
            const deposit = ethers.parseEther("1");
            await pool.connect(lp1).provideLiquidity({ value: deposit });

            // giả lập PolicyManager khoá hết vốn cho 1 policy
            await pool.connect(fakePolicyManager).lockCoverage(1, deposit);

            await expect(
                pool.connect(lp1).withdrawLiquidity(ethers.parseEther("0.1"))
            ).to.be.revertedWith("Khong du eth");
        });
    });

    describe("lockCoverage / depositPremium — quyền hạn", function () {
        it("revert nếu người gọi KHÔNG phải PolicyManager", async function () {
            const { pool, lp1 } = await deployFixture();

            await expect(
                pool.connect(lp1).lockCoverage(1, ethers.parseEther("1"))
            ).to.be.revertedWith("Khong phai la Policy Manager");
        });

        it("revert nếu khoá 2 lần cho cùng 1 policyId", async function () {
            const { pool, fakePolicyManager, lp1 } = await deployFixture();
            await pool.connect(lp1).provideLiquidity({ value: ethers.parseEther("5") });

            await pool.connect(fakePolicyManager).lockCoverage(1, ethers.parseEther("1"));

            await expect(
                pool.connect(fakePolicyManager).lockCoverage(1, ethers.parseEther("1"))
            ).to.be.revertedWith("Policy da duoc khoa");
        });
    });
});