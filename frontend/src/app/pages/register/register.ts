import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProfileFormComponent } from '../../components/profile-form/profile-form';
import { PrivateKeyBoxComponent } from '../../components/private-key-box/private-key-box';
import { ApiError } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { RegistrationDraftService } from '../../services/registration-draft.service';
import { ToastService } from '../../services/toast.service';
import { Web3Service } from '../../services/web3.service';
import { ProfileFormValue, emptyProfileForm, shortAddress, toProfileInput, validateProfile } from '../../utils/profile-form';

type Step = 1 | 2 | 3 | 4;
type Phase = 'idle' | 'working' | 'done';

interface NewWallet {
  address: string;
  privateKey: string;
}

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Tạo ví' },
  { n: 2, label: 'Sao lưu' },
  { n: 3, label: 'Hồ sơ' },
  { n: 4, label: 'Hoàn tất' },
];

/**
 * Đăng ký nông dân, wizard 4 bước (SPEC-B mục 9.2). Ví chỉ nằm trong bộ nhớ cho tới bước 4,
 * lúc bấm "Tạo tài khoản" mới lưu key vào máy rồi ký và gọi /api/auth/register.
 */
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [RouterLink, ProfileFormComponent, PrivateKeyBoxComponent],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card wide">
        <div class="auth-logo">🌾</div>
        <h1 class="auth-title">Đăng ký tài khoản</h1>
        <p class="auth-sub">Hệ thống thử nghiệm trên mạng Sepolia</p>

        <ol class="steps" aria-label="Các bước đăng ký">
          @for (s of steps; track s.n) {
            <li [class.current]="phase() !== 'done' && step() === s.n"
                [class.done]="phase() === 'done' || isStepDone(s.n)"
                [attr.aria-current]="phase() !== 'done' && step() === s.n ? 'step' : null">
              <span class="dot">{{ phase() === 'done' || isStepDone(s.n) ? '✓' : s.n }}</span>
              <span class="step-label">{{ s.label }}</span>
            </li>
          }
        </ol>

        @if (phase() === 'done') {
          <!-- ===== Thành công ===== -->
          <div class="success">
            <div class="big-check" aria-hidden="true">✓</div>
            <h2>Đăng ký thành công</h2>
            <dl class="summary">
              <dt>Địa chỉ ví</dt><dd class="mono">{{ wallet()?.address }}</dd>
              <dt>Số dư</dt><dd>{{ web3.balance() ?? '...' }} ETH</dd>
            </dl>
            @if (gasWarning(); as gw) {
              <div class="alert alert-warning" role="alert">
                <p>{{ gw }}</p>
                <button type="button" class="btn btn-outline" (click)="retryGas()" [disabled]="gasBusy()">
                  {{ gasBusy() ? 'Đang nạp...' : 'Nạp lại' }}
                </button>
              </div>
            }
            <div class="actions center">
              <a routerLink="/buy-policy" class="btn btn-primary">Mua bảo hiểm</a>
              <a [routerLink]="homeUrl()" class="btn btn-outline">Về tổng quan</a>
            </div>
          </div>
        } @else {
          @switch (step()) {
            @case (1) {
              <!-- ===== Bước 1: tạo ví ===== -->
              <h2 class="section-title">Bước 1. Tạo ví</h2>
              <ul class="explain">
                <li>Ví là tài khoản của bạn trong hệ thống.</li>
                <li>Ai giữ private key là giữ quyền với ví và các hợp đồng bảo hiểm của bạn.</li>
                <li>Mất private key thì không thể khôi phục, hệ thống không giữ hộ.</li>
              </ul>

              @if (wallet(); as w) {
                <div class="wallet-box">
                  <div class="wallet-label">Địa chỉ ví của bạn</div>
                  <div class="mono wrap">{{ w.address }}</div>
                </div>
                <div class="actions">
                  <button type="button" class="link-btn" (click)="resetWallet()">Chọn lại ví khác</button>
                  <button type="button" class="btn btn-primary" (click)="goStep(2)">Tiếp tục</button>
                </div>
              } @else if (deviceAddr(); as dev) {
                <div class="alert alert-warning" role="alert">
                  <p><strong>Thiết bị này đã có một ví.</strong> Bạn muốn dùng ví đó hay tạo ví mới?</p>
                </div>
                <div class="choice-group" role="radiogroup" aria-label="Chọn ví">
                  <label class="choice" [class.selected]="deviceChoice() === 'use'">
                    <input type="radio" name="device-choice" [checked]="deviceChoice() === 'use'" (change)="deviceChoice.set('use')" />
                    <span>Dùng ví đang có (<span class="mono">{{ short(dev) }}</span>)</span>
                  </label>
                  <label class="choice" [class.selected]="deviceChoice() === 'replace'">
                    <input type="radio" name="device-choice" [checked]="deviceChoice() === 'replace'" (change)="deviceChoice.set('replace')" />
                    <span>Tạo ví mới (thay thế ví hiện tại)</span>
                  </label>
                </div>
                @if (deviceChoice() === 'replace') {
                  <label class="check">
                    <input type="checkbox" [checked]="replaceAck()" (change)="replaceAck.set($any($event.target).checked)" />
                    <span>Tôi đã sao lưu ví cũ</span>
                  </label>
                }
                <div class="actions">
                  <button type="button" class="btn btn-primary" [disabled]="!canChooseDevice()" (click)="confirmDeviceChoice()">Tiếp tục</button>
                </div>
              } @else {
                <div class="actions">
                  <button type="button" class="btn btn-primary" (click)="createWallet()">Tạo ví mới</button>
                </div>
              }
            }

            @case (2) {
              <!-- ===== Bước 2: sao lưu ===== -->
              <h2 class="section-title">Bước 2. Sao lưu private key</h2>
              @if (wallet(); as w) {
                <p class="muted">Ví: <span class="mono">{{ short(w.address) }}</span>. Hãy lưu private key ở nơi an toàn trước khi tiếp tục.</p>
                <app-private-key-box [privateKey]="w.privateKey" [address]="w.address"
                  (keyCopied)="backedUpByCopy.set(true)" (keyDownloaded)="backedUpByDownload.set(true)" />

                <div class="field top-gap">
                  <label for="reg-last4">Nhập 4 ký tự cuối của private key để xác nhận</label>
                  <input id="reg-last4" type="text" maxlength="4" autocomplete="off" autocapitalize="off" spellcheck="false"
                    class="last4" [value]="last4()" (input)="last4.set($any($event.target).value)" />
                  @if (last4().length === 4 && !last4Ok()) { <p class="field-error">Chưa đúng, hãy kiểm tra lại key đã lưu</p> }
                </div>
                <label class="check">
                  <input type="checkbox" [checked]="backupAck()" (change)="backupAck.set($any($event.target).checked)" />
                  <span>Tôi đã lưu private key ở nơi an toàn và hiểu rằng mất key là mất tài khoản</span>
                </label>
                @if (!backedUpByCopy() && !backedUpByDownload()) {
                  <p class="hint">Hãy bấm Copy hoặc Tải file backup trước.</p>
                }

                <div class="actions">
                  <button type="button" class="btn btn-outline" (click)="goStep(1)">Quay lại</button>
                  <button type="button" class="btn btn-primary" [disabled]="!canLeaveBackup()" (click)="goStep(3)">Tiếp tục</button>
                </div>
              }
            }

            @case (3) {
              <!-- ===== Bước 3: hồ sơ ===== -->
              <h2 class="section-title">Bước 3. Hồ sơ nông dân</h2>
              @if (profileNotice(); as pn) { <div class="alert alert-error" role="alert">{{ pn }}</div> }
              <app-profile-form [(value)]="form" [serverErrors]="serverErrors()" [showAll]="showAllErrors()" />

              <label class="check">
                <input type="checkbox" [checked]="sepoliaAck()" (change)="sepoliaAck.set($any($event.target).checked)" />
                <span>Tôi hiểu đây là hệ thống thử nghiệm trên mạng Sepolia, không dùng tiền thật</span>
              </label>
              @if (showAllErrors() && !sepoliaAck()) { <p class="field-error">Vui lòng xác nhận để tiếp tục</p> }

              <div class="actions">
                @if (!skipBackup()) {
                  <button type="button" class="btn btn-outline" (click)="goStep(2)">Quay lại</button>
                } @else {
                  <span></span>
                }
                <button type="button" class="btn btn-primary" (click)="nextFromProfile()">Tiếp tục</button>
              </div>
            }

            @case (4) {
              <!-- ===== Bước 4: hoàn tất ===== -->
              <h2 class="section-title">Bước 4. Hoàn tất</h2>
              <dl class="summary">
                <dt>Ví</dt><dd class="mono">{{ short(wallet()?.address ?? null) }}</dd>
                <dt>Họ tên</dt><dd>{{ form().fullName }}</dd>
                <dt>Điện thoại</dt><dd>{{ form().phone }}</dd>
                <dt>Khu vực</dt><dd>{{ form().district }}, {{ form().province }}</dd>
                <dt>Cây trồng</dt><dd>{{ form().cropType }}, {{ form().farmAreaHa }} ha</dd>
              </dl>

              @if (alreadyRegistered()) {
                <div class="alert alert-warning" role="alert">
                  <p><strong>Ví này đã đăng ký.</strong></p>
                  <a routerLink="/login" class="btn btn-primary">Đăng nhập</a>
                </div>
              } @else if (submitError(); as se) {
                <div class="alert alert-error" role="alert"><p>{{ se }}</p></div>
              }

              @if (phase() === 'working') {
                <p class="progress-text" role="status"><span class="spinner" aria-hidden="true"></span> {{ workingText() }}</p>
              }

              <div class="actions">
                <button type="button" class="btn btn-outline" (click)="goStep(3)" [disabled]="phase() === 'working'">Quay lại</button>
                <button type="button" class="btn btn-primary" (click)="createAccount()"
                  [disabled]="phase() === 'working' || alreadyRegistered()">
                  {{ submitError() ? 'Thử lại' : 'Tạo tài khoản' }}
                </button>
              </div>
            }
          }

          <p class="links">Đã có tài khoản? <a routerLink="/login">Đăng nhập</a></p>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .auth-card.wide { max-width: 560px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .wrap { word-break: break-all; }
      .section-title { font-size: 17px; margin: 0 0 12px; }
      .muted { color: var(--color-text-secondary); font-size: 14px; margin: 0 0 12px; }
      .hint { color: var(--color-text-muted); font-size: 13px; margin: 0 0 8px; }
      .top-gap { margin-top: 16px; }
      .steps { display: flex; list-style: none; padding: 0; margin: 0 0 20px; gap: 4px; }
      .steps li { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; position: relative; font-size: 12px; color: var(--color-text-muted); }
      .steps li::before { content: ''; position: absolute; top: 14px; left: -50%; width: 100%; height: 2px; background: var(--color-border); z-index: 0; }
      .steps li:first-child::before { display: none; }
      .steps .dot { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; position: relative; z-index: 1; }
      .steps li.current { color: var(--color-primary-dark); font-weight: 700; }
      .steps li.current .dot { border-color: var(--color-primary); color: var(--color-primary-dark); }
      .steps li.done .dot { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
      .steps li.done::before, .steps li.current::before { background: var(--color-primary); }
      .explain { padding-left: 20px; margin: 0 0 16px; color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; }
      .wallet-box { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 4px; }
      .wallet-label { font-size: 12px; font-weight: 700; color: var(--color-text-secondary); margin-bottom: 4px; }
      .choice-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
      .choice { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-weight: 500; margin: 0; }
      .choice.selected { border-color: var(--color-primary); background: var(--color-bg-secondary); }
      .choice input { width: auto; }
      .check { display: flex; align-items: flex-start; gap: 8px; font-weight: 500; margin: 12px 0 8px; }
      .check input { width: auto; margin-top: 3px; }
      .last4 { max-width: 140px; font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 2px; }
      .actions { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
      .actions.center { justify-content: center; }
      .summary { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0 0 14px; font-size: 14px; }
      .summary dt { color: var(--color-text-secondary); font-weight: 600; }
      .summary dd { margin: 0; word-break: break-word; }
      .progress-text { display: flex; align-items: center; gap: 8px; color: var(--color-text-secondary); font-size: 14px; }
      .success { text-align: center; }
      .success .summary { text-align: left; max-width: 420px; margin: 0 auto 14px; }
      .big-check { width: 56px; height: 56px; border-radius: 50%; background: var(--color-primary-light); color: var(--color-primary-dark); font-size: 30px; display: flex; align-items: center; justify-content: center; margin: 0 auto 8px; }
      .alert p { margin: 0 0 8px; }
      .alert p:last-child { margin-bottom: 0; }
      @media (max-width: 480px) { .steps .step-label { font-size: 11px; } .summary { grid-template-columns: 1fr; gap: 0; } .summary dd { margin-bottom: 8px; } }
    `,
  ],
})
export class Register implements OnInit {
  readonly web3 = inject(Web3Service);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly draft = inject(RegistrationDraftService);
  private readonly toast = inject(ToastService);

  readonly steps = STEPS;
  readonly step = signal<Step>(1);
  readonly phase = signal<Phase>('idle');

  // Bước 1
  readonly wallet = signal<NewWallet | null>(null);
  readonly deviceAddr = signal<string | null>(null);
  readonly deviceChoice = signal<'use' | 'replace'>('use');
  readonly replaceAck = signal(false);
  /** true khi ví đến từ khôi phục (người dùng vừa dán key): bỏ qua bước 1 và 2. */
  readonly skipBackup = signal(false);
  readonly canChooseDevice = computed(() => this.deviceChoice() === 'use' || this.replaceAck());

  // Bước 2
  readonly backedUpByCopy = signal(false);
  readonly backedUpByDownload = signal(false);
  readonly last4 = signal('');
  readonly backupAck = signal(false);
  readonly last4Ok = computed(() => {
    const key = this.wallet()?.privateKey ?? '';
    const typed = this.last4().trim().toLowerCase();
    return typed.length === 4 && key.slice(-4).toLowerCase() === typed;
  });
  readonly canLeaveBackup = computed(
    () => (this.backedUpByCopy() || this.backedUpByDownload()) && this.last4Ok() && this.backupAck(),
  );

  // Bước 3
  form = signal<ProfileFormValue>(emptyProfileForm());
  readonly sepoliaAck = signal(false);
  readonly showAllErrors = signal(false);
  readonly serverErrors = signal<Record<string, string> | null>(null);
  readonly profileNotice = signal<string | null>(null);

  // Bước 4
  readonly workingText = signal('');
  readonly submitError = signal<string | null>(null);
  readonly alreadyRegistered = signal(false);
  readonly gasWarning = signal<string | null>(null);
  readonly gasBusy = signal(false);
  private walletSaved = false;

  private returnUrl: string | null = null;

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    this.deviceAddr.set(this.web3.storedAddress());

    const draft = this.draft.take();
    if (draft) {
      this.wallet.set({ address: draft.address, privateKey: draft.privateKey });
      if (draft.source === 'recovered') {
        this.skipBackup.set(true);
        this.step.set(3);
      } else {
        this.step.set(2);
      }
    }
  }

  short(addr: string | null): string {
    return shortAddress(addr);
  }

  homeUrl(): string {
    return this.auth.safeReturnUrl(this.returnUrl, '/dashboard');
  }

  isStepDone(n: Step): boolean {
    if (n < this.step()) return true;
    // Ví khôi phục: bước 1 và 2 coi như đã xong.
    return this.skipBackup() && n <= 2;
  }

  goStep(n: Step): void {
    this.step.set(n);
  }

  // ----- Bước 1 -----

  createWallet(): void {
    this.wallet.set(this.web3.createWallet());
    this.resetBackupState();
  }

  confirmDeviceChoice(): void {
    if (this.deviceChoice() === 'use') {
      const privateKey = this.web3.exportPrivateKey();
      const address = this.web3.storedAddress();
      if (!privateKey || !address) {
        this.toast.error('Không đọc được ví trên thiết bị, hãy tạo ví mới hoặc khôi phục ở trang đăng nhập');
        return;
      }
      this.wallet.set({ address, privateKey });
      this.walletSaved = true; // đã nằm sẵn trong máy
    } else {
      this.wallet.set(this.web3.createWallet());
    }
    this.resetBackupState();
    this.step.set(2);
  }

  resetWallet(): void {
    this.wallet.set(null);
    this.walletSaved = false;
    this.resetBackupState();
  }

  private resetBackupState(): void {
    this.backedUpByCopy.set(false);
    this.backedUpByDownload.set(false);
    this.last4.set('');
    this.backupAck.set(false);
  }

  // ----- Bước 3 -----

  nextFromProfile(): void {
    this.showAllErrors.set(true);
    this.profileNotice.set(null);
    const errors = validateProfile(this.form());
    if (Object.keys(errors).length > 0 || !this.sepoliaAck()) {
      this.profileNotice.set('Vui lòng điền đúng các ô được đánh dấu.');
      return;
    }
    this.serverErrors.set(null);
    this.step.set(4);
  }

  // ----- Bước 4 -----

  async createAccount(): Promise<void> {
    const w = this.wallet();
    if (!w || this.phase() === 'working') return;

    this.submitError.set(null);
    this.alreadyRegistered.set(false);
    this.phase.set('working');

    try {
      if (!this.walletSaved) {
        this.workingText.set('Đang lưu ví vào thiết bị...');
        await this.web3.saveWallet(w.privateKey);
        this.walletSaved = true;
      }
      this.workingText.set('Đang ký và tạo tài khoản...');
      const result = await this.auth.register(toProfileInput(this.form()));
      this.gasWarning.set(result.gasWarning ?? null);
      this.phase.set('done');
      void this.web3.refreshBalance();
    } catch (e) {
      this.phase.set('idle');
      this.handleError(e);
    }
  }

  private handleError(e: unknown): void {
    if (e instanceof ApiError) {
      if (e.status === 409 && e.code === 'ALREADY_REGISTERED') {
        this.alreadyRegistered.set(true);
        return;
      }
      if (e.status === 400 && e.code === 'VALIDATION') {
        this.serverErrors.set(e.fields ?? {});
        this.profileNotice.set('Máy chủ báo một số thông tin chưa hợp lệ, vui lòng sửa các ô được đánh dấu.');
        this.showAllErrors.set(true);
        this.step.set(3);
        return;
      }
      if (e.status === 429) {
        this.submitError.set('Thử quá nhiều lần, vui lòng đợi vài phút rồi thử lại.');
        return;
      }
      if (e.status === 0 || e.status >= 500) {
        this.submitError.set('Không kết nối được máy chủ. Thông tin của bạn vẫn được giữ, hãy thử lại.');
        return;
      }
      this.submitError.set(e.message);
      return;
    }
    this.submitError.set(e instanceof Error ? e.message : 'Đăng ký thất bại');
  }

  async retryGas(): Promise<void> {
    this.gasBusy.set(true);
    try {
      await this.web3.ensureGas();
      this.gasWarning.set(null);
      this.toast.success('Đã nạp gas cho ví');
    } catch (e) {
      this.gasWarning.set(e instanceof Error ? e.message : 'Không nạp được gas');
    } finally {
      this.gasBusy.set(false);
    }
  }
}
