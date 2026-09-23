import { Component, inject } from '@angular/core';
import { Web3Service } from '../../services/web3.service';

@Component({
  selector: 'app-connect-wallet-button',
  standalone: true,
  template: `
    @if (web3.address(); as addr) {
      <div class="wallet-badge">
        <span class="dot"></span>
        {{ shorten(addr) }}
        <button class="btn-disconnect" (click)="web3.disconnect()">✕</button>
      </div>
    } @else {
      <button class="btn btn-primary" (click)="web3.connect()" [disabled]="web3.isConnecting()">
        {{ web3.isConnecting() ? 'Đang kết nối...' : 'Đăng nhập bằng ví điện tử' }}
      </button>
    }
    @if (web3.errorMessage(); as err) {
      <p class="wallet-error">{{ err }}</p>
    }
  `,
  styles: [`
    .wallet-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      background-color: var(--color-primary-light);
      color: var(--color-primary-dark);
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--color-primary);
    }
    .btn-disconnect {
      background: none;
      border: none;
      color: var(--color-primary-dark);
      cursor: pointer;
      font-size: 14px;
      padding: 0 0 0 4px;
    }
    .wallet-error {
      color: var(--color-error);
      font-size: 13px;
      margin-top: 6px;
    }
  `],
})
export class ConnectWalletButtonComponent {
  readonly web3 = inject(Web3Service);

  shorten(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }
}