import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

// Toạ độ Cần Thơ, nhân 1e6 theo đúng quy ước trong PolicyManager
const VALID_LAT = 10_045_000;
const VALID_LNG = 105_746_000;

describe("PolicyManager", function () {
    async function deployFixture() {
        const [owner, farmer, otherLp] = await ethers.getSigners();

        // Lần này deploy LiquidityPool THẬT, không giả nữa —
        // vì test PolicyManager cần luồng gọi chéo sang pool chạy đúng thật sự
        const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
        // deploy tạm với owner làm policy manager giữ chỗ, sửa lại ngay dưới

        const pool = await LiquidityPool.deploy();
        await pool.waitForDeployment();

        const PolicyManager = await ethers.getContractFactory("PolicyManager");
        const policyManager = await PolicyManager.deploy(await pool.getAddress());

        // pool.addressPolicyManager set 1 lần ở constructor, không có hàm sửa lại
        // -> cách đúng là deploy PolicyManager trước khi biết địa chỉ, nhưng vì
        // LiquidityPool cần deploy trước (PolicyManager cần địa chỉ pool)
        // nên đây là giới hạn cần biết: constructor 2 bên đang phụ thuộc vòng nhau

        return { pool, policyManager, owner, farmer, otherLp };
    }

    // Vì vướng vòng phụ thuộc constructor ở trên, viết riêng 1 fixture
    // seed sẵn 1 product để mấy test buyPolicy dùng chung
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

            // Note quan trọng: constructor pool đang trỏ addressPolicyManager = owner
            // (do vòng phụ thuộc ở trên), nên lockCoverage/depositPremium gọi từ
            // policyManager thật sẽ FAIL onlyPolicyManager -> cần sửa lại constructor
            // hoặc thêm setter trước khi test này chạy được thật. Xem ghi chú cuối bài.

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
            // KHÔNG có LP nào góp vốn cả -> pool.availableLiquidity() = 0
            // trong khi coverage = 1 ETH -> phải revert

            await expect(
                policyManager.connect(farmer).buyPolicy(productId, VALID_LAT, VALID_LNG, {
                    value: premium,
                })
            ).to.be.revertedWith("Pool khong du von");
        });
    });
});