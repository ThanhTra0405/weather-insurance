import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("SelfHostedOracle", function () {
    async function deployFixture() {
        const [owner, backend, stranger] = await ethers.getSigners();
        const SelfHostedOracle = await ethers.getContractFactory("SelfHostedOracle");
        const oracle = await SelfHostedOracle.deploy(backend.address);
        await oracle.waitForDeployment();
        return { oracle, owner, backend, stranger };
    }

    it("chi backendSigner goi submitWeatherData duoc", async function () {
        const { oracle, backend } = await deployFixture();
        const regionId = ethers.keccak256(ethers.toUtf8Bytes("test-region"));

        await expect(oracle.connect(backend).submitWeatherData(regionId, 30, 1000)).to.not.revert(ethers);

        const [value, ts] = await oracle.getWeatherData(regionId);
        expect(value).to.equal(30);
        expect(ts).to.equal(1000);
    });

    it("revert neu nguoi khac goi submitWeatherData", async function () {
        const { oracle, stranger } = await deployFixture();
        const regionId = ethers.keccak256(ethers.toUtf8Bytes("test-region"));

        await expect(
            oracle.connect(stranger).submitWeatherData(regionId, 30, 1000)
        ).to.be.revertedWith("Khong phai backend signer");
    });

    it("owner doi duoc backendSigner", async function () {
        const { oracle, owner, stranger } = await deployFixture();
        await oracle.connect(owner).setBackendSigner(stranger.address);
        expect(await oracle.backendSigner()).to.equal(stranger.address);
    });
});