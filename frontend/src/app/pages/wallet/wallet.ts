import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PrivateKeyBoxComponent } from '../../components/private-key-box/private-key-box';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { Web3Service } from '../../services/web3.service';

/**
 * /wallet: sao lưu ví và khôi phục ví (SPEC-B mục 9.3.7).
 * Private key chỉ nằm trong localStorage của trình duyệt này; trang không gửi key đi đâu.
 */
@Component({
  selector: 'app-wallet',
  standalone: true,
  imports: [RouterLink, PrivateKeyBoxComponent],
  template: `
    <div class="container page">
      <div class="page-head">
        <div>
          <h1>Ví của tôi</h1>
          <p class="page-sub">Sao lưu và khôi phục ví trên thiết bị này</p>
        </div>
      </div>

      <div class="alert alert-warning big" role="alert">
        <strong>Mất private key = mất quyền với policy và số tiền trong ví.</strong>
        Hệ thống không lưu key của bạn nên không thể khôi phục giúp. Hãy tải file backup và cất ở nơi an toàn.
      </div>

      <section class="card block">
        <h2>Địa chỉ ví</h2>
        @if (address(); as addr) {
          <p class="addr mono">{{ addr }}</p>
          <p class="muted">Số dư: <strong>{{ web3.balance() ?? '—' }} ETH</strong> · Mạng thử nghiệm Sepolia</p>
        } @else {
          <p class="muted">Thiết bị này chưa có ví. Hãy khôi phục ví bằng private key bên dưới hoặc <a routerLink="/login">đăng nhập lại</a>.</p>
        }
      </section>

      @if (address()) {
        <section class="card block">
          <h2>Sao lưu private key</h2>
          @if (!acknowledged()) {
            <label class="check-row">
              <input type="checkbox" [checked]="ack()" (change)="ack.set($any($event.target).checked)" />
              <span>Tôi hiểu đây là chìa khoá duy nhất của ví, không chia sẻ cho bất kỳ ai.</span>
            </label>
            <button type="button" class="btn btn-primary" [disabled]="!ack()" (click)="acknowledged.set(true)">Hiện công cụ sao lưu</button>
          } @else if (privateKey(); as pk) {
            <app-private-key-box [privateKey]="pk" [address]="address()!" (keyCopied)="onBackedUp('copy')" (keyDownloaded)="onBackedUp('file')" />
            <p class="hint">Key luôn ẩn; giữ nút 2 giây để hiện. File backup: <span class="mono">weather-insurance-wallet.json</span>.</p>
          } @else {
            <div class="alert alert-error" role="alert">Không đọc được private key trên thiết bị này.</div>
          }
        </section>
      }

      <section class="card block">
        <h2>Khôi phục ví</h2>
        <div class="alert alert-warning" role="note">
          Khôi phục bằng một ví <strong>khác</strong> sẽ thay thế ví hiện tại trên thiết bị này. Bạn sẽ bị đăng xuất và cần đăng nhập lại bằng ví mới.
        </div>

        <div class="field">
          <label for="w-key">Private key</label>
          <div class="key-row">
            <input id="w-key" [type]="showKey() ? 'text' : 'password'" autocomplete="off" spellcheck="false" placeholder="0x… (64 ký tự hex)"
              [value]="keyInput()" [disabled]="busy()" [attr.aria-invalid]="!!importError()" (input)="onKeyInput($any($event.target).value)" />
            <button type="button" class="btn btn-outline btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Ẩn' : 'Hiện' }}</button>
          </div>
          <p class="hint">Hoặc chọn file backup (.json) đã tải trước đó:</p>
          <input type="file" accept=".json,application/json" class="file" aria-label="Chọn file backup" (change)="onFile($event)" [disabled]="busy()" />
          @if (importError(); as ie) { <p class="field-error" role="alert">{{ ie }}</p> }
        </div>

        @if (candidate(); as c) {
          <div class="candidate">
            <div class="hint">Ví đọc được từ key:</div>
            <div class="mono addr">{{ c }}</div>
            @if (sameWallet()) {
              <p class="alert alert-info">Đây chính là ví đang dùng trên thiết bị này, không cần khôi phục.</p>
            } @else {
              <label class="check-row">
                <input type="checkbox" [checked]="confirmReplace()" (change)="confirmReplace.set($any($event.target).checked)" />
                <span>{{ address() ? 'Tôi đã sao lưu ví hiện tại và đồng ý thay thế nó bằng ví này.' : 'Lưu ví này vào thiết bị.' }}</span>
              </label>
            }
          </div>
        }

        <button type="button" class="btn btn-danger" (click)="onRestore()"
          [disabled]="busy() || !candidate() || sameWallet() || !confirmReplace()">
          @if (busy()) { <span class="spinner" aria-hidden="true"></span> Đang xử lý... } @else { {{ address() ? 'Thay ví' : 'Khôi phục ví' }} }
        </button>
      </section>
    </div>
  `,
  styles: [
    `
      .page { max-width: 720px; padding-top: 24px; padding-bottom: 48px; }
      .big { font-size: 15px; line-height: 1.5; }
      .block { margin-bottom: 14px; }
      h2 { font-size: 16px; margin: 0 0 10px; color: var(--color-primary-dark); }
      .addr { word-break: break-all; margin: 0 0 6px; }
      .muted { margin: 0; color: var(--color-text-secondary); font-size: 14px; }
      .hint { font-size: 12.5px; color: var(--color-text-muted); margin: 8px 0 6px; }
      .check-row { margin-bottom: 12px; }
      .key-row { display: flex; gap: 8px; }
      .file { padding: 8px; font-size: 13.5px; }
      .candidate { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 14px; }
      .candidate .alert { margin: 8px 0 0; }
    `,
  ],
})
export class WalletPage {
  readonly web3 = inject(Web3Service);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly ack = signal(false);
  readonly acknowledged = signal(false);

  readonly keyInput = signal('');
  readonly showKey = signal(false);
  readonly importError = signal<string | null>(null);
  readonly candidateInfo = signal<{ address: string; privateKey: string } | null>(null);
  readonly confirmReplace = signal(false);
  readonly busy = signal(false);

  readonly address = computed(() => this.web3.address() ?? this.web3.storedAddress());
  /** Đọc private key khi cần (không giữ trong signal lâu dài). */
  readonly privateKey = computed(() => (this.acknowledged() ? this.web3.exportPrivateKey() : null));
  readonly candidate = computed(() => this.candidateInfo()?.address ?? null);
  readonly sameWallet = computed(() => {
    const c = this.candidate();
    const current = this.address();
    return !!c && !!current && c.toLowerCase() === current.toLowerCase();
  });

  onBackedUp(how: 'copy' | 'file'): void {
    this.toast.success(how === 'copy' ? 'Đã copy private key. Hãy cất ở nơi an toàn.' : 'Đã tải file backup. Hãy cất ở nơi an toàn.');
  }

  onKeyInput(value: string): void {
    this.keyInput.set(value);
    this.parse(value);
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 20_000) throw new Error('File backup không hợp lệ');
      const text = await file.text();
      this.keyInput.set('');
      this.parse(text);
    } catch (e) {
      this.candidateInfo.set(null);
      this.importError.set(e instanceof Error ? e.message : 'Không đọc được file');
    } finally {
      input.value = '';
    }
  }

  /** Kiểm tra key/file ngay khi nhập, chưa lưu gì. */
  private parse(raw: string): void {
    this.confirmReplace.set(false);
    if (!raw.trim()) {
      this.candidateInfo.set(null);
      this.importError.set(null);
      return;
    }
    try {
      this.candidateInfo.set(this.web3.importPrivateKey(raw));
      this.importError.set(null);
    } catch (e) {
      this.candidateInfo.set(null);
      this.importError.set(e instanceof Error ? e.message : 'Private key không hợp lệ');
    }
  }

  async onRestore(): Promise<void> {
    const info = this.candidateInfo();
    if (!info || this.busy() || this.sameWallet() || !this.confirmReplace()) return;

    this.busy.set(true);
    try {
      const hadWallet = !!this.address();
      await this.web3.saveWallet(info.privateKey);
      this.keyInput.set('');
      this.candidateInfo.set(null);
      this.confirmReplace.set(false);

      if (this.auth.isLoggedIn() || hadWallet) {
        // JWT hiện tại thuộc ví cũ: đăng xuất (giữ ví mới trên máy) để đăng nhập lại bằng ví mới.
        this.toast.success('Đã thay ví. Vui lòng đăng nhập lại bằng ví mới.');
        await this.auth.logout();
      } else {
        this.toast.success('Đã khôi phục ví trên thiết bị này.');
      }
    } catch (e) {
      this.importError.set(e instanceof Error ? e.message : 'Không khôi phục được ví');
    } finally {
      this.busy.set(false);
    }
  }
}
