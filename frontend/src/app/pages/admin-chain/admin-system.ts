import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ToastService } from '../../services/toast.service';
import { AdminChainApi, PauseResult, SystemInfo } from './admin-chain.api';
import { errMsg, fmtEth, isLow, shortHex, txUrl } from './ac-utils';

interface Target {
  key: 'policyManager' | 'pool' | 'payoutEngine';
  label: string;
}

@Component({
  selector: 'app-admin-system',
  standalone: true,
  template: `
    <h1 class="ac-h1">Hệ thống</h1>
    <p class="ac-sub">Trạng thái 3 contract và các địa chỉ quyền hạn.</p>

    @if (error()) {
      <div class="ac-alert err">{{ error() }}</div>
    }

    @if (info(); as s) {
      @if (!s.signerMatches) {
        <div class="ac-alert err">
          Oracle signer KHÔNG khớp với ví operator của backend — oracle sẽ không ghi được dữ liệu.
          Kiểm tra lại <code>Blockchain:OperatorPrivateKey</code> hoặc gọi <code>setBackendSigner</code> trên contract oracle.
        </div>
      }
      @if (isLow(s.operatorBalanceWei)) {
        <div class="ac-alert warn">Số dư operator dưới 0.05 ETH, sắp hết gas.</div>
      }

      <h2 class="ac-sec">Trạng thái tạm dừng</h2>
      <div class="ac-grid">
        @for (t of targets; track t.key) {
          <div class="ac-card">
            <h3>{{ t.label }}</h3>
            <div class="ac-row">
              <span class="ac-badge" [class.bad]="paused(s, t.key)">{{ paused(s, t.key) ? 'Đang tạm dừng' : 'Đang chạy' }}</span>
            </div>
            @if (paused(s, t.key)) {
              <button class="ac-btn ghost sm" [disabled]="busy()" (click)="toggle(t.key, false)">Tiếp tục (Unpause)</button>
            } @else {
              <button class="ac-btn danger sm" [disabled]="busy()" (click)="toggle(t.key, true)">Tạm dừng (Pause)</button>
            }
          </div>
        }
      </div>
      <div class="ac-row">
        <button class="ac-btn danger" [disabled]="busy()" (click)="toggle('all', true)">Tạm dừng tất cả</button>
        <button class="ac-btn ghost" [disabled]="busy()" (click)="toggle('all', false)">Tiếp tục tất cả</button>
      </div>

      @if (results().length > 0) {
        <div class="ac-alert ok">
          @for (r of results(); track r.target) {
            <div>
              {{ r.target }}:
              @if (r.error) { <span>lỗi — {{ r.error }}</span> }
              @else if (!r.changed) { <span>không thay đổi (đã ở trạng thái đó)</span> }
              @else if (url(r.txHash); as u) { <a [href]="u" target="_blank" rel="noopener">{{ short(r.txHash) }}</a> }
              @else { <span class="ac-mono">{{ short(r.txHash) }}</span> }
            </div>
          }
        </div>
      }

      <h2 class="ac-sec">Địa chỉ & số dư</h2>
      <div class="ac-card">
        <div class="ac-line"><span>Owner</span><span class="ac-mono">{{ s.owner }}</span></div>
        <div class="ac-line"><span>Verifier</span><span class="ac-mono">{{ s.verifier }}</span></div>
        <div class="ac-line"><span>Oracle signer</span><span class="ac-mono">{{ s.oracleSigner }}</span></div>
        <div class="ac-line"><span>Operator (backend)</span><span class="ac-mono">{{ s.operatorAddress }}</span></div>
        <div class="ac-line"><span>Số dư operator</span><span>{{ eth(s.operatorBalanceWei) }} ETH</span></div>
        <div class="ac-line"><span>Ví faucet</span><span class="ac-mono">{{ s.faucetAddress ?? '—' }}</span></div>
        <div class="ac-line"><span>Số dư faucet</span><span>{{ eth(s.faucetBalanceWei) }} ETH</span></div>
        <div class="ac-line"><span>Cooling-off</span><span>{{ s.coolingOffSeconds }} giây</span></div>
        <div class="ac-line">
          <span>Oracle signer khớp operator</span>
          <span class="ac-badge" [class.bad]="!s.signerMatches">{{ s.signerMatches ? 'Khớp' : 'Không khớp' }}</span>
        </div>
      </div>
    } @else if (!error()) {
      <p class="ac-muted">Đang tải…</p>
    }
  `,
})
export class AdminSystem {
  private readonly api = inject(AdminChainApi);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly targets: Target[] = [
    { key: 'policyManager', label: 'PolicyManager' },
    { key: 'pool', label: 'LiquidityPool' },
    { key: 'payoutEngine', label: 'PayoutEngine' },
  ];

  readonly info = signal<SystemInfo | null>(null);
  readonly results = signal<PauseResult[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly eth = fmtEth;
  readonly isLow = isLow;
  readonly short = (h: string | null) => shortHex(h, 10, 8);
  readonly url = txUrl;

  constructor() {
    if (this.isBrowser) void this.load();
  }

  paused(s: SystemInfo, key: Target['key']): boolean {
    return s.paused[key];
  }

  private async load(): Promise<void> {
    try {
      this.info.set(await this.api.system());
      this.error.set(null);
    } catch (e) {
      this.error.set(errMsg(e, 'Không đọc được thông tin hệ thống'));
    }
  }

  async toggle(target: Target['key'] | 'all', pause: boolean): Promise<void> {
    const name = target === 'all' ? 'TẤT CẢ contract' : target;
    const action = pause ? 'TẠM DỪNG' : 'TIẾP TỤC';
    if (!confirm(`Xác nhận ${action} ${name}?`)) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      const res = pause ? await this.api.pause(target) : await this.api.unpause(target);
      this.results.set(res);
      this.toast.success(pause ? 'Đã gửi lệnh tạm dừng' : 'Đã gửi lệnh tiếp tục');
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
