import { Component, ElementRef, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Web3Service } from '../../services/web3.service';

/** Thay ConnectWalletButton: nút Đăng nhập/Đăng ký khi chưa đăng nhập, menu tài khoản khi đã đăng nhập. */
@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (!auth.isLoggedIn()) {
      <div class="guest-actions">
        <a routerLink="/login" class="btn btn-outline">Đăng nhập</a>
        <a routerLink="/register" class="btn btn-primary">Đăng ký</a>
        <a routerLink="/staff/login" class="staff-link">Nhân viên</a>
      </div>
    } @else {
      <div class="account">
        <button
          type="button"
          class="account-button"
          aria-haspopup="menu"
          [attr.aria-expanded]="open()"
          (click)="toggle($event)"
        >
          <span class="dot"></span>
          <span class="account-text">
            <span class="account-name">{{ auth.fullName() ?? roleLabel() }}</span>
            @if (auth.role() === 'farmer') {
              <span class="account-sub">
                {{ shortAddress() }}@if (web3.balance(); as bal) { · {{ bal }} ETH }
              </span>
            } @else {
              <span class="account-sub">{{ roleLabel() }}</span>
            }
          </span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>

        @if (open()) {
          <div class="menu" role="menu">
            @if (auth.role() === 'farmer') {
              <a role="menuitem" routerLink="/profile" (click)="open.set(false)">Hồ sơ</a>
              <a role="menuitem" routerLink="/wallet" (click)="open.set(false)">Sao lưu ví</a>
              <button type="button" role="menuitem" (click)="logout()">Đăng xuất</button>
              <button type="button" role="menuitem" class="danger" (click)="openForgetDialog()">
                Đăng xuất và xoá ví khỏi thiết bị
              </button>
            } @else {
              <a role="menuitem" routerLink="/staff/account" (click)="open.set(false)">Tài khoản</a>
              <button type="button" role="menuitem" (click)="logout()">Đăng xuất</button>
            }
          </div>
        }
      </div>
    }

    @if (forgetDialogOpen()) {
      <div class="overlay" (click)="closeForgetDialog()">
        <div
          class="dialog card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forget-title"
          (click)="$event.stopPropagation()"
        >
          <h2 id="forget-title">Xoá ví khỏi thiết bị</h2>
          <p>
            Private key sẽ bị xoá khỏi trình duyệt này. Nếu chưa sao lưu, bạn
            <strong>không thể khôi phục</strong> tài khoản và số tiền trong ví.
          </p>
          <label class="check">
            <input type="checkbox" [checked]="backedUp()" (change)="backedUp.set($any($event.target).checked)" />
            <span>Tôi đã sao lưu private key</span>
          </label>
          <label for="forget-confirm">Gõ <strong>XOA</strong> để xác nhận</label>
          <input
            id="forget-confirm"
            type="text"
            autocomplete="off"
            [value]="confirmText()"
            (input)="confirmText.set($any($event.target).value)"
          />
          <div class="dialog-actions">
            <button type="button" class="btn btn-outline" (click)="closeForgetDialog()">Huỷ</button>
            <button type="button" class="btn btn-danger" [disabled]="!canForget() || busy()" (click)="confirmForget()">
              {{ busy() ? 'Đang xử lý...' : 'Đăng xuất và xoá ví' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .guest-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .guest-actions .btn {
        padding: 8px 16px;
        font-size: 14px;
      }
      .staff-link {
        font-size: 12px;
        color: var(--color-text-muted);
        margin-left: 4px;
      }
      .account {
        position: relative;
      }
      .account-button {
        display: flex;
        align-items: center;
        gap: 8px;
        background-color: var(--color-primary-light);
        color: var(--color-primary-dark);
        border: none;
        border-radius: 999px;
        padding: 6px 14px;
        cursor: pointer;
        font-family: inherit;
        text-align: left;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--color-primary);
        flex-shrink: 0;
      }
      .account-text {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
        min-width: 0;
      }
      .account-name {
        font-size: 14px;
        font-weight: 600;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .account-sub {
        font-size: 12px;
        opacity: 0.85;
        white-space: nowrap;
      }
      .caret {
        font-size: 12px;
      }
      .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        min-width: 240px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-md);
        padding: 6px;
        display: flex;
        flex-direction: column;
        z-index: 20;
      }
      .menu a,
      .menu button {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        padding: 10px 12px;
        border-radius: 6px;
        font-family: inherit;
        font-size: 14px;
        color: var(--color-text);
        cursor: pointer;
      }
      .menu a:hover,
      .menu button:hover {
        background-color: var(--color-bg-secondary);
      }
      .menu .danger {
        color: var(--color-error);
      }
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        z-index: 1100;
      }
      .dialog {
        width: 100%;
        max-width: 420px;
      }
      .dialog h2 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      .dialog p {
        margin: 0 0 12px;
        font-size: 14px;
        color: var(--color-text-secondary);
      }
      .check {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }
      .check input {
        width: auto;
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
      .btn-danger {
        background-color: var(--color-error);
        color: #fff;
      }
      @media (max-width: 640px) {
        .account-name {
          max-width: 110px;
        }
        .staff-link {
          display: none;
        }
      }
    `,
  ],
})
export class AccountMenuComponent {
  readonly auth = inject(AuthService);
  readonly web3 = inject(Web3Service);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly open = signal(false);
  readonly forgetDialogOpen = signal(false);
  readonly backedUp = signal(false);
  readonly confirmText = signal('');
  readonly busy = signal(false);

  readonly canForget = computed(() => this.backedUp() && this.confirmText().trim() === 'XOA');

  readonly roleLabel = computed(() => {
    switch (this.auth.role()) {
      case 'admin':
        return 'Quản trị viên';
      case 'support':
        return 'CSKH';
      default:
        return 'Nông dân';
    }
  });

  readonly shortAddress = computed(() => {
    const addr = this.auth.wallet() ?? this.web3.address();
    return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
  });

  constructor() {
    // Cập nhật số dư mỗi khi nông dân đăng nhập.
    effect(() => {
      if (this.auth.isLoggedIn() && this.auth.role() === 'farmer') {
        untracked(() => void this.web3.refreshBalance());
      }
    });
  }

  toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((v) => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
    this.closeForgetDialog();
  }

  async logout(): Promise<void> {
    this.open.set(false);
    await this.auth.logout();
  }

  openForgetDialog(): void {
    this.open.set(false);
    this.backedUp.set(false);
    this.confirmText.set('');
    this.forgetDialogOpen.set(true);
  }

  closeForgetDialog(): void {
    if (this.busy()) return;
    this.forgetDialogOpen.set(false);
  }

  async confirmForget(): Promise<void> {
    if (!this.canForget()) return;
    this.busy.set(true);
    try {
      await this.auth.logout({ forgetWallet: true });
      this.forgetDialogOpen.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
