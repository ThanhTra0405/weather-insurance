# Solidity + Hardhat: Từ Cơ Bản Đến Deploy & Kết Nối Frontend

## 0. Chuẩn bị môi trường

```bash
node -v   # >= 18
npm -v

mkdir my-dapp && cd my-dapp
npx hardhat init
```

Chọn `Create a TypeScript project` (khuyến nghị) hoặc JavaScript. Hardhat 2.22+ dùng Hardhat Toolbox mặc định gồm: ethers.js, chai matchers, gas reporter, solidity-coverage, TypeChain.

Cấu trúc thư mục:
```
contracts/       # file .sol
scripts/         # script deploy
test/             # test
ignition/modules/ # deployment modules (Hardhat Ignition)
hardhat.config.ts
```

---

## 1. Solidity cơ bản

### 1.1 Skeleton file
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public count;

    event CountChanged(uint256 newCount);

    function increment() external {
        count += 1;
        emit CountChanged(count);
    }
}
```

### 1.2 Kiểu dữ liệu chính
- Value types: `uint256/int256` (mặc định dùng uint256), `bool`, `address`, `address payable`, `bytes32`, `string`
- Reference types: `array`, `mapping`, `struct`
- `uint8..uint256` (bước nhảy 8), tối ưu gas khi pack struct

```solidity
mapping(address => uint256) public balances;

struct Stream {
    address sender;
    address recipient;
    uint256 deposit;
    uint256 startTime;
    uint256 stopTime;
}
Stream[] public streams;
```

### 1.3 Function visibility & mutability
- `external / public / internal / private`
- `view` (đọc state, không ghi), `pure` (không đọc/ghi state), `payable` (nhận ETH)

### 1.4 Modifiers
```solidity
modifier onlyOwner() {
    require(msg.sender == owner, "Not owner");
    _;
}
```

### 1.5 Error handling
```solidity
require(amount > 0, "Amount must be > 0");
if (amount == 0) revert InvalidAmount(); // custom error, rẻ gas hơn require string
error InvalidAmount();
```

### 1.6 Events & indexed params
```solidity
event StreamCreated(uint256 indexed streamId, address indexed sender, address indexed recipient, uint256 deposit);
```
`indexed` (tối đa 3) giúp filter log ở frontend qua `ethers` mà không cần đọc toàn bộ event.

### 1.7 msg.sender / msg.value / block
```solidity
function deposit() external payable {
    require(msg.value > 0);
}
```

---

## 2. Solidity trung cấp

### 2.1 Inheritance & Interface
```solidity
interface IStreamable {
    function createStream(address recipient, uint256 deposit, uint256 duration) external returns (uint256);
}

abstract contract Ownable {
    address public owner;
    constructor() { owner = msg.sender; }
    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
}

contract TokenStream is Ownable, IStreamable {
    function createStream(address recipient, uint256 deposit, uint256 duration)
        external override returns (uint256) { /* ... */ }
}
```

### 2.2 OpenZeppelin (bắt buộc dùng cho production)
```bash
npm install @openzeppelin/contracts
```
```solidity
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/SafeERC20.sol";
```

### 2.3 ERC20 tương tác (quan trọng cho thesis kiểu Token Streaming/Insurance dùng token)
```solidity
using SafeERC20 for IERC20;

function fund(address token, uint256 amount) external {
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
}
```

### 2.4 Reentrancy & Checks-Effects-Interactions
```solidity
function withdraw(uint256 streamId) external nonReentrant {
    Stream storage s = streams[streamId];
    uint256 amount = _balanceOf(s);       // 1. check
    s.withdrawn += amount;                // 2. effect (update state TRƯỚC)
    IERC20(s.token).safeTransfer(msg.sender, amount); // 3. interaction (gọi ngoài SAU)
}
```

### 2.5 Oracle pattern (liên quan Weather Insurance)
```solidity
interface IWeatherOracle {
    function getRainfall(string calldata location, uint256 timestamp) external view returns (uint256);
}

contract WeatherInsurance {
    IWeatherOracle public oracle;

    function claim(uint256 policyId) external {
        uint256 rainfall = oracle.getRainfall(policies[policyId].location, block.timestamp);
        require(rainfall < policies[policyId].threshold, "Condition not met");
        _payout(policyId);
    }
}
```
Thực tế dùng Chainlink Functions/Any-API để lấy dữ liệu off-chain (API thời tiết) on-chain — đáng nhắc trong thesis vì đây là điểm mấu chốt kỹ thuật.

---

## 3. Solidity nâng cao

### 3.1 Gas optimization
- Pack struct để chung 1 slot 32 bytes (ví dụ: `uint128 + uint128` thay vì 2 `uint256`)
- Dùng `calldata` thay vì `memory` cho tham số external function
- Cache biến storage vào local var trong loop
- Custom errors thay vì `require(string)`
- `unchecked { }` khi chắc chắn không overflow (Solidity >=0.8 tự check overflow, tốn gas)

### 3.2 Upgradeable contracts (Proxy pattern)
```bash
npm install @openzeppelin/hardhat-upgrades
```
```solidity
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract StreamV1 is Initializable, OwnableUpgradeable {
    function initialize() public initializer {
        __Ownable_init(msg.sender);
    }
}
```
Deploy bằng plugin `hardhat-upgrades` (`upgrades.deployProxy`) thay vì deploy thường — quan trọng nếu thesis cần khả năng nâng cấp logic sau khi deploy.

### 3.3 Security checklist trước khi deploy
- Reentrancy guard cho hàm có external call + thay đổi state
- Access control rõ ràng (`onlyOwner`, role-based với `AccessControl`)
- Integer overflow: Solidity 0.8+ tự động revert, nhưng vẫn kiểm tra logic chia/làm tròn
- Không dùng `tx.origin` để authen
- Kiểm tra `block.timestamp` chỉ nên dùng cho khoảng thời gian tương đối lớn (miner có thể lệch vài giây)
- Chạy `npx hardhat coverage` và test edge case (0, max uint, address(0))
- Cân nhắc audit tool: Slither, MythX (không bắt buộc cho thesis nhưng cộng điểm)

---

## 4. Testing với Hardhat

```bash
npm install --save-dev @nomicfoundation/hardhat-toolbox
```

```ts
// test/TokenStream.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TokenStream", () => {
  async function deployFixture() {
    const [owner, sender, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock", "MCK", ethers.parseEther("1000000"));

    const Stream = await ethers.getContractFactory("TokenStream");
    const stream = await Stream.deploy();

    return { stream, token, owner, sender, recipient };
  }

  it("tạo stream thành công", async () => {
    const { stream, token, sender, recipient } = await deployFixture();
    await token.transfer(sender.address, ethers.parseEther("100"));
    await token.connect(sender).approve(stream.target, ethers.parseEther("100"));

    await expect(
      stream.connect(sender).createStream(recipient.address, token.target, ethers.parseEther("100"), 3600)
    ).to.emit(stream, "StreamCreated");
  });

  it("revert nếu deposit = 0", async () => {
    const { stream, sender, recipient } = await deployFixture();
    await expect(
      stream.connect(sender).createStream(recipient.address, ethers.ZeroAddress, 0, 3600)
    ).to.be.revertedWithCustomError(stream, "InvalidAmount");
  });
});
```

```bash
npx hardhat test
npx hardhat coverage
REPORT_GAS=true npx hardhat test   # xem gas usage
```

---

## 5. Cấu hình deploy lên Sepolia

### 5.1 `.env`
```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<API_KEY>
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```
Lấy RPC free tại Alchemy hoặc Infura. Lấy Sepolia ETH test tại faucet (Alchemy Sepolia Faucet, hoặc Chainlink Faucet).

```bash
npm install --save-dev dotenv
```

### 5.2 `hardhat.config.ts`
```ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
export default config;
```

### 5.3 Deploy bằng Hardhat Ignition (khuyến nghị, thay thế script deploy cũ)
```ts
// ignition/modules/TokenStream.ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TokenStreamModule", (m) => {
  const stream = m.contract("TokenStream");
  return { stream };
});
```

```bash
npx hardhat ignition deploy ignition/modules/TokenStream.ts --network sepolia
```

### 5.4 Verify trên Etherscan
```bash
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS> <constructor_args...>
```
Nếu dùng Ignition, chạy `npx hardhat ignition verify <deploymentId>` để verify tự động toàn bộ contract trong deployment.

---

## 6. Kết nối Frontend

### 6.1 Cài đặt
```bash
npm install ethers wagmi viem @rainbow-me/rainbowkit @tanstack/react-query
```
- `ethers.js v6` — đơn giản, đủ dùng cho thesis
- `wagmi + viem + RainbowKit` — production-grade, hỗ trợ multi-wallet, hook React sẵn (khuyến nghị nếu FE là React)

### 6.2 Lấy ABI + address sau khi deploy
Sau `hardhat compile`, ABI nằm ở `artifacts/contracts/TokenStream.sol/TokenStream.json`. Copy phần `abi` vào FE, hoặc dùng TypeChain để generate type tự động (`npx hardhat typechain`).

### 6.3 Cách A — ethers.js thuần (nhanh, đơn giản)
```ts
// lib/contract.ts
import { ethers } from "ethers";
import TokenStreamABI from "./abi/TokenStream.json";

export const CONTRACT_ADDRESS = "0xYourDeployedAddress";

export async function getContract() {
  if (!window.ethereum) throw new Error("Chưa cài MetaMask");
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new ethers.Contract(CONTRACT_ADDRESS, TokenStreamABI.abi, signer);
}
```

```tsx
// component
async function handleCreateStream() {
  const contract = await getContract();
  const tx = await contract.createStream(recipient, tokenAddress, ethers.parseEther(amount), duration);
  await tx.wait();
  console.log("Stream created");
}
```

Nghe event real-time:
```ts
contract.on("StreamCreated", (streamId, sender, recipient, deposit) => {
  console.log({ streamId, sender, recipient, deposit });
});
```

### 6.4 Cách B — wagmi + viem (khuyến nghị nếu cần đa ví, UX tốt)
```tsx
// wagmi.config.ts
import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: { [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL) },
});
```

```tsx
// hook đọc/ghi contract
import { useReadContract, useWriteContract } from "wagmi";
import TokenStreamABI from "./abi/TokenStream.json";

function useCreateStream() {
  const { writeContract, data: hash } = useWriteContract();
  return (recipient: string, token: string, amount: bigint, duration: bigint) =>
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: TokenStreamABI.abi,
      functionName: "createStream",
      args: [recipient, token, amount, duration],
    });
}

function useStreamBalance(streamId: bigint) {
  return useReadContract({
    address: CONTRACT_ADDRESS,
    abi: TokenStreamABI.abi,
    functionName: "balanceOf",
    args: [streamId],
  });
}
```

### 6.5 Kết nối ví (RainbowKit — nhanh nhất)
```tsx
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, getDefaultConfig, ConnectButton } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";

const config = getDefaultConfig({
  appName: "Linnear",
  projectId: "YOUR_WALLETCONNECT_PROJECT_ID",
  chains: [sepolia],
});

// trong App: bọc <WagmiProvider config={config}><RainbowKitProvider>...</RainbowKitProvider></WagmiProvider>
// và dùng <ConnectButton /> để hiện nút Connect Wallet
```

---

## 7. Checklist end-to-end cho thesis

1. Viết contract → test đầy đủ (happy path + revert case) → coverage > 80%
2. Deploy Sepolia qua Ignition → verify Etherscan
3. Copy ABI + address vào FE (hoặc publish package npm riêng cho contracts nếu 2 người tách repo BE/FE)
4. FE dùng wagmi/ethers gọi contract, lắng nghe event để update UI real-time
5. Test toàn bộ flow bằng ví MetaMask trên Sepolia testnet trước khi bảo vệ đồ án
6. Chuẩn bị sẵn vài giao dịch mẫu (tx hash) trên Sepolia Etherscan để demo cho hội đồng

---

## 8. Tài nguyên tham khảo thêm
- Solidity docs: soliditylang.org/docs
- Hardhat docs: hardhat.org/docs
- OpenZeppelin Contracts: docs.openzeppelin.com/contracts
- wagmi docs: wagmi.sh
- Chainlink Functions (nếu dùng oracle thời tiết thật): docs.chain.link/chainlink-functions
