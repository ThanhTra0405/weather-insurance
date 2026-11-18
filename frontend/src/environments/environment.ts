// LOCAL (Hardhat node). Địa chỉ giữ nguyên theo lần deploy local của bạn.
export const environment = {
  production: false,
  rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/alch_EhZvvflJaYTuu5I9wRy48',
  chainId: 11155111,
  devFaucet: false, // chỉ true khi chạy Hardhat local
  faucetUrl: '',
  policyManagerAddress: '0x70F307D9442721DD1A439A5739868bc71cE58701',
  payoutEngineAddress: '0xA91648989A79771D34C80f7529C19cbeDe7bb116',
  liquidityPoolAddress: '0xDFA4341eB544Bc7584a43DafeB27e24cfD6559e1',
  backendUrl: 'http://localhost:5083',
  explorerTxBase: 'https://sepolia.etherscan.io/tx/'
};
