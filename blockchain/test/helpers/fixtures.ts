export const PREMIUM = 100_000_000_000_000_000n; 
export const COVERAGE = 1_000_000_000_000_000_000n; 
export const THRESHOLD = 50n;
export const DURATION_DAYS = 30;
export const DEFAULT_LIQUIDITY = 10_000_000_000_000_000_000n; 

export const VALID_LAT = 10_045_000n;
export const VALID_LNG = 105_746_000n;

// Nhận `ethers` làm tham số — KHÔNG tự network.connect() nữa
export async function deployAllFixture(ethers: any) {
    const [owner, farmer, lp1, verifier] = await ethers.getSigners();

    const MockWeatherOracle = await ethers.getContractFactory("MockWeatherOracle");
    const oracle = await MockWeatherOracle.deploy();
    await oracle.waitForDeployment();

    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    const pool = await LiquidityPool.deploy();
    await pool.waitForDeployment();

    const PolicyManager = await ethers.getContractFactory("PolicyManager");
    const policyManager = await PolicyManager.deploy(await pool.getAddress());
    await policyManager.waitForDeployment();

    const PayoutEngine = await ethers.getContractFactory("PayoutEngine");
    const payoutEngine = await PayoutEngine.deploy(
        await policyManager.getAddress(),
        await pool.getAddress(),
        await oracle.getAddress()
    );
    await payoutEngine.waitForDeployment();

    await pool.connect(owner).setPolicyManager(await policyManager.getAddress());
    await pool.connect(owner).setPayoutEngine(await payoutEngine.getAddress());
    await policyManager.connect(owner).setPayoutEngine(await payoutEngine.getAddress());
    await policyManager.connect(owner).setVerifier(verifier.address);

    return { oracle, pool, policyManager, payoutEngine, owner, farmer, lp1, verifier };
}

export async function seedLiquidityFixture(ethers: any) {
    const base = await deployAllFixture(ethers);
    await base.pool.connect(base.lp1).provideLiquidity({ value: DEFAULT_LIQUIDITY });
    return { ...base, seededAmount: DEFAULT_LIQUIDITY };
}

export async function withActivePolicyFixture(ethers: any) {
    const base = await seedLiquidityFixture(ethers);

    await base.policyManager.connect(base.owner).createPolicyProduct(
        "Han han Can Tho", 0, THRESHOLD, DURATION_DAYS, PREMIUM, COVERAGE
    );
    const productId = 1n;

    await base.policyManager
        .connect(base.farmer)
        .buyPolicy(productId, VALID_LAT, VALID_LNG, { value: PREMIUM });
    const policyId = 1n;

    await base.policyManager.connect(base.verifier).verifyPolicy(policyId, true);
    const policy = await base.policyManager.getPolicy(policyId);

    return {
        ...base, policyId, productId,
        premium: PREMIUM, coverage: COVERAGE, threshold: THRESHOLD,
        regionId: policy.regionId,
    };
}