import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { JsonRpcProvider, Wallet, Signer, parseEther, toQuantity } from 'ethers';
import { environment } from '../../environments/environment';

const STORAGE_KEY = 'wi_wallet_pk';
const DISCONNECTED_KEY = 'wi_wallet_disconnected';
const MIN_GAS = parseEther('0.01');

@Injectable({ providedIn: 'root' })
export class Web3Service {
  readonly address = signal<string | null>(null);
  readonly chainId = signal<number | null>(null);
  readonly isConnecting = signal(true);
  readonly errorMessage = signal<string | null>(null);

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private provider = new JsonRpcProvider(environment.rpcUrl);
  private wallet?: Wallet;
  ready: Promise<void>;

  constructor() {
    if (!this.isBrowser) {
      // Prerender/SSR: không có localStorage
      this.ready = Promise.resolve();
    } else if (localStorage.getItem(DISCONNECTED_KEY)) {
      // Người dùng đã bấm ngắt kết nối trước đó: không tự kết nối lại
      this.isConnecting.set(false);
      this.ready = Promise.resolve();
    } else {
      this.ready = this.init();
    }
  }

  get isConnected(): boolean {
    return this.address() !== null;
  }

  /** Kết nối (hoặc kết nối lại) ví. Dùng lại private key đã lưu nếu có. */
  connect(): Promise<void> {
    if (!this.isBrowser) return Promise.resolve();
    localStorage.removeItem(DISCONNECTED_KEY);
    this.errorMessage.set(null);
    this.isConnecting.set(true);
    this.ready = this.init();
    return this.ready;
  }

  /** Ngắt kết nối khỏi app. Private key vẫn giữ trong localStorage để kết nối lại đúng ví cũ. */
  disconnect(): void {
    if (this.isBrowser) localStorage.setItem(DISCONNECTED_KEY, '1');
    this.wallet = undefined;
    this.address.set(null);
    this.chainId.set(null);
    this.errorMessage.set(null);
  }

  private async init(): Promise<void> {
    try {
      let pk = localStorage.getItem(STORAGE_KEY);
      if (!pk) {
        pk = Wallet.createRandom().privateKey;
        localStorage.setItem(STORAGE_KEY, pk);
      }
      this.wallet = new Wallet(pk, this.provider);
      this.address.set(this.wallet.address);

      const network = await this.provider.getNetwork();
      const chain = Number(network.chainId);
      this.chainId.set(chain);
      if (chain !== environment.chainId) {
        this.errorMessage.set(`Sai mạng blockchain (cần chainId ${environment.chainId})`);
        return;
      }

      await this.ensureGas(this.wallet.address);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Không tạo được ví');
    } finally {
      this.isConnecting.set(false);
    }
  }

  private async ensureGas(addr: string): Promise<void> {
    const balance = await this.provider.getBalance(addr);
    if (balance >= MIN_GAS) return;

    if (environment.devFaucet) {
      await this.provider.send('hardhat_setBalance', [addr, toQuantity(parseEther('100'))]);
    } else if (environment.faucetUrl) {
      const res = await fetch(environment.faucetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr }),
      });
      if (!res.ok) throw new Error('Không nạp được gas cho ví mới');
    }
  }

  getSigner(): Signer {
    if (!this.wallet) throw new Error('Ví chưa sẵn sàng');
    return this.wallet;
  }

  getProvider(): JsonRpcProvider {
    return this.provider;
  }
}