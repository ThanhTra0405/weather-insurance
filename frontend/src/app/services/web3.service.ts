import { Injectable, signal } from '@angular/core';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

@Injectable({ providedIn: 'root' })
export class Web3Service {
  readonly address = signal<string | null>(null);
  readonly chainId = signal<number | null>(null);
  readonly isConnecting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  private provider?: BrowserProvider;
  private signer?: JsonRpcSigner;

  get isConnected(): boolean {
    return this.address() !== null;
  }

  async connect(): Promise<void> {
    const eth = (window as any).ethereum;
    if (!eth) {
      this.errorMessage.set('Chưa có ví — hãy mở trang này trong app ví hoặc cài MetaMask');
      return;
    }

    this.isConnecting.set(true);
    this.errorMessage.set(null);

    try {
      this.provider = new BrowserProvider(eth);
      await eth.request({ method: 'eth_requestAccounts' });
      this.signer = await this.provider.getSigner();
      this.address.set(await this.signer.getAddress());

      const network = await this.provider.getNetwork();
      this.chainId.set(Number(network.chainId));

      eth.on('accountsChanged', (accs: string[]) => this.address.set(accs[0] ?? null));
      eth.on('chainChanged', () => window.location.reload());
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Không kết nối được ví');
    } finally {
      this.isConnecting.set(false);
    }
  }

  disconnect(): void {
    this.address.set(null);
    this.chainId.set(null);
    this.provider = undefined;
    this.signer = undefined;
  }

  getSigner(): JsonRpcSigner {
    if (!this.signer) throw new Error('Chưa kết nối ví');
    return this.signer;
  }

  getProvider(): BrowserProvider {
    if (!this.provider) throw new Error('Chưa kết nối ví');
    return this.provider;
  }
}