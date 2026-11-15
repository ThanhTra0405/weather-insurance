import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { JsonRpcProvider, Wallet, Signer, formatEther, parseEther, toQuantity } from 'ethers';
import { environment } from '../../environments/environment';
import { ApiError, ApiService } from './api.service';

const STORAGE_KEY = 'wi_wallet_pk';
const MIN_GAS = parseEther('0.01');

/** Ví vừa tạo hoặc vừa khôi phục (chưa chắc đã lưu vào máy). */
export interface WalletInfo {
  address: string;
  privateKey: string;
}

/**
 * Ví của nông dân nằm trong trình duyệt (localStorage). Không tự tạo ví khi mở trang:
 * chỉ nạp ví nếu đã có (đăng ký, khôi phục từ private key hoặc file backup).
 */
@Injectable({ providedIn: 'root' })
export class Web3Service {
  readonly address = signal<string | null>(null);
  readonly chainId = signal<number | null>(null);
  readonly isConnecting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** Số dư ETH (đã làm tròn 4 chữ số), null khi chưa biết. */
  readonly balance = signal<string | null>(null);

  private readonly api = inject(ApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private _provider?: JsonRpcProvider;
  private wallet?: Wallet;
  ready: Promise<void>;

  constructor() {
    this.ready = this.isBrowser && this.hasStoredWallet() ? this.init() : Promise.resolve();
  }

  /** Provider tạo lười, chỉ tồn tại ở trình duyệt. */
  private get provider(): JsonRpcProvider {
    if (!this.isBrowser) {
      throw new Error('Provider chỉ dùng được ở trình duyệt');
    }
    return (this._provider ??= new JsonRpcProvider(environment.rpcUrl));
  }

  get isConnected(): boolean {
    return this.address() !== null;
  }

  // ===== Quản lý ví trên thiết bị =====

  hasStoredWallet(): boolean {
    return this.isBrowser && !!localStorage.getItem(STORAGE_KEY);
  }

  /** Địa chỉ của ví đang lưu trên máy (đọc từ private key), null nếu chưa có hoặc key hỏng. */
  storedAddress(): string | null {
    if (!this.isBrowser) return null;
    const pk = localStorage.getItem(STORAGE_KEY);
    if (!pk) return null;
    try {
      return new Wallet(pk).address;
    } catch {
      return null;
    }
  }

  /** Tạo ví mới trong bộ nhớ, CHƯA lưu vào máy. */
  createWallet(): WalletInfo {
    const wallet = Wallet.createRandom();
    return { address: wallet.address, privateKey: wallet.privateKey };
  }

  /** Lưu private key vào máy rồi nạp ví. */
  async saveWallet(privateKey: string): Promise<void> {
    if (!this.isBrowser) return;
    const info = this.importPrivateKey(privateKey);
    localStorage.setItem(STORAGE_KEY, info.privateKey);
    this.ready = this.init();
    await this.ready;
  }

  /**
   * Kiểm tra private key (có/không 0x) hoặc nội dung file backup JSON { address, privateKey }.
   * Chỉ trả thông tin ví, KHÔNG lưu. Sai định dạng thì ném Error('Private key không hợp lệ').
   */
  importPrivateKey(input: string): WalletInfo {
    let raw = (input ?? '').trim();

    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { privateKey?: unknown };
        raw = typeof parsed.privateKey === 'string' ? parsed.privateKey.trim() : '';
      } catch {
        throw new Error('File backup không hợp lệ');
      }
    }

    raw = raw.replace(/^["']|["']$/g, '').trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) raw = '0x' + raw;

    try {
      const wallet = new Wallet(raw);
      return { address: wallet.address, privateKey: wallet.privateKey };
    } catch {
      throw new Error('Private key không hợp lệ');
    }
  }

  exportPrivateKey(): string | null {
    return this.isBrowser ? localStorage.getItem(STORAGE_KEY) : null;
  }

  /** Xoá private key khỏi máy (không thể khôi phục nếu chưa sao lưu). */
  forgetWallet(): void {
    if (this.isBrowser) localStorage.removeItem(STORAGE_KEY);
    this.wallet = undefined;
    this.address.set(null);
    this.chainId.set(null);
    this.balance.set(null);
    this.errorMessage.set(null);
    this.ready = Promise.resolve();
  }

  // ===== Nạp ví, ký, gas =====

  private async init(): Promise<void> {
    this.isConnecting.set(true);
    this.errorMessage.set(null);
    try {
      const pk = localStorage.getItem(STORAGE_KEY);
      if (!pk) {
        this.wallet = undefined;
        this.address.set(null);
        return;
      }

      this.wallet = new Wallet(pk, this.provider);
      this.address.set(this.wallet.address);

      const network = await this.provider.getNetwork();
      const chain = Number(network.chainId);
      this.chainId.set(chain);
      if (chain !== environment.chainId) {
        this.errorMessage.set(`Sai mạng blockchain (cần chainId ${environment.chainId})`);
      }
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Không nạp được ví');
    } finally {
      this.isConnecting.set(false);
    }
  }

  /** Ký message (dùng cho đăng nhập bằng chữ ký ví). */
  async signMessage(message: string): Promise<string> {
    await this.ready;
    if (!this.wallet) throw new Error('Thiết bị chưa có ví');
    return this.wallet.signMessage(message);
  }

  /**
   * Đảm bảo ví có đủ gas. Chỉ gọi sau khi đăng nhập/đăng ký thành công.
   * Local (devFaucet): hardhat_setBalance. Sepolia: POST /api/faucet (kèm Bearer, do Người A làm).
   * Ném Error với thông báo tiếng Việt khi không nạp được.
   */
  async ensureGas(): Promise<void> {
    await this.ready;
    const addr = this.address();
    if (!addr) throw new Error('Thiết bị chưa có ví');

    const balance = await this.provider.getBalance(addr);
    if (balance < MIN_GAS) {
      if (environment.devFaucet) {
        await this.provider.send('hardhat_setBalance', [addr, toQuantity(parseEther('100'))]);
      } else {
        try {
          await this.api.post('/api/faucet', {});
        } catch (e) {
          throw new Error(this.faucetMessage(e));
        }
      }
    }
    await this.refreshBalance();
  }

  private faucetMessage(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.status === 429) return e.message || 'Đã nhận ETH gần đây, vui lòng thử lại sau';
      if (e.status === 503) return 'Faucet tạm hết ETH';
      if (e.status === 404) return 'Máy chủ chưa có faucet (đang chờ Người A)';
    }
    return 'Không nạp được gas cho ví mới';
  }

  /** Cập nhật số dư ETH; lỗi mạng thì giữ giá trị cũ. */
  async refreshBalance(): Promise<void> {
    if (!this.isBrowser) return;
    await this.ready;
    const addr = this.address();
    if (!addr) {
      this.balance.set(null);
      return;
    }
    try {
      const wei = await this.provider.getBalance(addr);
      this.balance.set(Number(formatEther(wei)).toFixed(4));
    } catch {
      // giữ nguyên số dư cũ
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
