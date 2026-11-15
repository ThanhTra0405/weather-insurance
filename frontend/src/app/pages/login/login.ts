import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { RegistrationDraftService, WalletDraft } from '../../services/registration-draft.service';
import { ToastService } from '../../services/toast.service';
import { Web3Service } from '../../services/web3.service';
import { shortAddress } from '../../utils/profile-form';

/** Đăng nhập nông dân bằng chữ ký ví (SPEC-B mục 9.2). */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="auth-logo">🌾</div>
        <h1 class="auth-title">Bảo hiểm thời tiết</h1>
        <p class="auth-sub">Hệ thống thử nghiệm trên mạng Sepolia</p>

        @if (reason() === 'restore-wallet') {
          <div class="alert alert-info" role="status">Cần khôi phục ví trên thiết bị này để tiếp tục.</div>
        }

        @if (notRegistered(); as nr) {
          <div class="alert alert-warning" role="alert">
            <p><strong>Ví này chưa đăng ký.</strong> <span class="mono">{{ short(nr.address) }}</span></p>
            <button type="button" class="btn btn-primary" (click)="registerWithThisWallet()">Đăng ký với ví này</button>
          </div>
        }

        @if (errorMsg(); as msg) {
          <div class="alert alert-error" role="alert">
            <p>{{ msg }}</p>
            @if (retryable()) {
              <button type="button" class="btn btn-outline" (click)="submit()" [disabled]="busy()">Thử lại</button>
            }
          </div>
        }

        <form (submit)="onSubmit($event)" novalidate>
          @if (mode() === 'stored') {
            <p class="device-wallet">Ví trên thiết bị: <span class="mono">{{ short(storedAddr()) }}</span></p>
            <button type="submit" class="btn btn-primary btn-block" [disabled]="busy()">
              @if (busy()) { <span class="spinner" aria-hidden="true"></span> Đang đăng nhập... }
              @else { Đăng nhập bằng ví này }
            </button>
            <p class="links">
              <button type="button" class="link-btn" (click)="switchMode('recover')">Dùng ví khác (khôi phục từ private key)</button>
            </p>
          } @else {
            <h2 class="section-title">Khôi phục ví</h2>
            <div class="field">
              <label for="login-key">Private key</label>
              <div class="input-with-btn">
                <input id="login-key" [type]="showKey() ? 'text' : 'password'" autocomplete="off" autocapitalize="off"
                  spellcheck="false" placeholder="0x..." [value]="fileName() ? '' : keyInput()"
                  [disabled]="busy() || !!fileName()" (input)="onKeyInput($event)" />
                <button type="button" class="btn btn-outline small" (click)="showKey.set(!showKey())"
                  [attr.aria-pressed]="showKey()" [disabled]="!!fileName()">{{ showKey() ? 'Ẩn' : 'Hiện' }}</button>
              </div>
            </div>
            <div class="or">hoặc</div>
            <div class="file-row">
              <label class="btn btn-outline file-btn" [class.disabled]="busy()">
                Chọn file backup (.json)
                <input type="file" accept=".json,application/json" class="sr-only" [disabled]="busy()" (change)="onFile($event)" />
              </label>
              @if (fileName(); as fname) {
                <span class="file-name">{{ fname }}</span>
                <button type="button" class="link-btn" (click)="clearFile()">Bỏ file</button>
              }
            </div>
            <button type="submit" class="btn btn-primary btn-block" [disabled]="busy()">
              @if (busy()) { <span class="spinner" aria-hidden="true"></span> Đang đăng nhập... }
              @else { Đăng nhập }
            </button>
            @if (storedAddr()) {
              <p class="links">
                <button type="button" class="link-btn" (click)="switchMode('stored')">Dùng ví trên thiết bị ({{ short(storedAddr()) }})</button>
              </p>
            }
          }
        </form>

        <p class="links">Chưa có tài khoản? <a routerLink="/register" [queryParams]="registerQuery()">Đăng ký</a></p>
        <p class="help">Quên private key? Hệ thống không thể khôi phục. Hãy dùng file backup đã tải khi đăng ký.</p>
        <p class="help"><a routerLink="/staff/login">Bạn là nhân viên? Đăng nhập tại đây</a></p>
      </div>
    </div>
  `,
  styles: [
    `
      .device-wallet { margin: 0 0 14px; text-align: center; color: var(--color-text-secondary); }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .section-title { font-size: 16px; margin: 0 0 12px; }
      .input-with-btn { display: flex; gap: 8px; }
      .input-with-btn .small { padding: 8px 12px; font-size: 13px; flex-shrink: 0; }
      .or { text-align: center; color: var(--color-text-muted); font-size: 13px; margin: 10px 0; }
      .file-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
      .file-btn { cursor: pointer; }
      .file-btn.disabled { opacity: 0.5; pointer-events: none; }
      .file-name { font-size: 13px; color: var(--color-text-secondary); word-break: break-all; }
      .alert p { margin: 0 0 8px; }
      .alert p:last-child { margin-bottom: 0; }
    `,
  ],
})
export class Login implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly web3 = inject(Web3Service);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly draft = inject(RegistrationDraftService);
  private readonly toast = inject(ToastService);

  readonly storedAddr = signal<string | null>(null);
  readonly mode = signal<'stored' | 'recover'>('recover');
  readonly reason = signal<string | null>(null);
  readonly returnUrl = signal<string | null>(null);

  readonly keyInput = signal('');
  readonly fileName = signal<string | null>(null);
  readonly showKey = signal(false);

  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly retryable = signal(false);
  readonly notRegistered = signal<WalletDraft | null>(null);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.reason.set(params.get('reason'));
    this.returnUrl.set(params.get('returnUrl'));

    const stored = this.web3.storedAddress();
    this.storedAddr.set(stored);
    this.mode.set(stored && this.reason() !== 'restore-wallet' ? 'stored' : 'recover');
  }

  short(addr: string | null): string {
    return shortAddress(addr);
  }

  registerQuery(): Record<string, string> | undefined {
    const url = this.returnUrl();
    return url ? { returnUrl: url } : undefined;
  }

  switchMode(mode: 'stored' | 'recover'): void {
    this.mode.set(mode);
    this.resetMessages();
  }

  onKeyInput(event: Event): void {
    this.keyInput.set((event.target as HTMLInputElement).value);
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // cho phép chọn lại đúng file đó lần sau
    if (!file) return;
    this.resetMessages();
    if (file.size > 100_000) {
      this.errorMsg.set('File backup không hợp lệ (quá lớn)');
      return;
    }
    try {
      this.keyInput.set(await file.text());
      this.fileName.set(file.name);
    } catch {
      this.errorMsg.set('Không đọc được file backup');
    }
  }

  clearFile(): void {
    this.fileName.set(null);
    this.keyInput.set('');
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.resetMessages();

    // Khôi phục: validate key ở máy, chưa lưu, chưa gọi server nếu sai.
    let recovered: { address: string; privateKey: string } | null = null;
    if (this.mode() === 'recover') {
      if (!this.keyInput().trim()) {
        this.errorMsg.set('Vui lòng dán private key hoặc chọn file backup');
        return;
      }
      try {
        recovered = this.web3.importPrivateKey(this.keyInput());
      } catch (e) {
        this.errorMsg.set(e instanceof Error ? e.message : 'Private key không hợp lệ');
        return;
      }
    }

    this.busy.set(true);
    try {
      const result = await this.auth.loginWithWallet(recovered ? { privateKey: recovered.privateKey } : undefined);
      if (result.gasWarning) this.toast.warning(result.gasWarning);
      await this.router.navigateByUrl(this.auth.safeReturnUrl(this.returnUrl(), '/dashboard'));
    } catch (e) {
      this.handleError(e, recovered);
    } finally {
      this.busy.set(false);
    }
  }

  registerWithThisWallet(): void {
    const nr = this.notRegistered();
    if (!nr) return;
    this.draft.set(nr);
    void this.router.navigate(['/register'], { queryParams: this.registerQuery() });
  }

  private handleError(e: unknown, recovered: { address: string; privateKey: string } | null): void {
    if (e instanceof ApiError) {
      if (e.status === 404 && e.code === 'NOT_REGISTERED') {
        const address = recovered?.address ?? this.storedAddr();
        const privateKey = recovered?.privateKey ?? this.web3.exportPrivateKey();
        if (address && privateKey) {
          this.notRegistered.set({ address, privateKey, source: recovered ? 'recovered' : 'device' });
          return;
        }
        this.errorMsg.set('Ví này chưa đăng ký tài khoản');
        return;
      }
      if (e.status === 429) {
        this.errorMsg.set('Thử quá nhiều lần, vui lòng đợi vài phút');
        return;
      }
      if (e.status === 0 || e.status >= 500) {
        this.errorMsg.set('Không kết nối được máy chủ');
        this.retryable.set(true);
        return;
      }
      if (e.code === 'INVALID_SIGNATURE' || e.code === 'NONCE_EXPIRED') {
        this.errorMsg.set('Không xác thực được chữ ký ví, vui lòng thử lại');
        this.retryable.set(true);
        return;
      }
      this.errorMsg.set(e.message);
      return;
    }
    this.errorMsg.set(e instanceof Error ? e.message : 'Đăng nhập thất bại');
  }

  private resetMessages(): void {
    this.errorMsg.set(null);
    this.retryable.set(false);
    this.notRegistered.set(null);
  }
}
