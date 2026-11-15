export const environment = {
  production: false,
  rpcUrl: 'http://127.0.0.1:8545',
  chainId: 31337, //11155111
  devFaucet: true, // chỉ true khi chạy Hardhat local
  faucetUrl: '', // Sepolia: `${backendUrl}/api/faucet`
  policyManagerAddress: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  payoutEngineAddress: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  liquidityPoolAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  backendUrl: 'http://localhost:5083',
};