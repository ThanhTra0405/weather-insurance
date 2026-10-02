export const environment = {
  production: false,
  rpcUrl: 'http://127.0.0.1:8545',
  chainId: 11155111,
  devFaucet: true, // chỉ true khi chạy Hardhat local
  faucetUrl: '', // Sepolia: `${backendUrl}/api/faucet`
  policyManagerAddress: '0x6FB68f5B95d537611D1a291b3bf7df1faa08F013',
  payoutEngineAddress: '0xB43728e44937B51894D257714dB2d40cf4bAE258',
  liquidityPoolAddress: '0x7Ec5cbb5bA939116A4283Cc7F41A514556eAdB62',
  backendUrl: 'http://localhost:5083',
};