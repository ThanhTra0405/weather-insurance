import { Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiError } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { AdminChainApi, CycleResult, OracleStatus } from './admin-chain.api';
import { PERIL_LABELS, errMsg, fmtAge, fmtOracleValue, fmtTime, perilLabel, shortHex, txUrl } from './ac-utils';

@Component({
  selector: 'app-admin-oracle',
  standalone: true,
  template: `
    <h1 class="ac-h1">Oracle thời tiết</h1>
    <p class="ac-sub">Dữ liệu được ghi lên blockchain theo vùng và loại rủi ro.</p>

    @if (error()) {
      <div class="ac-alert err">{{ error() }}</div>
    }

    @if (status(); as s) {
      @if (s.signerMatches === false) {
        <div class="ac-alert err">Oracle signer không khớp ví operator ({{ short2(s.oracleSigner) }} ≠ {{ short2(s.operatorAddress) }}).</div>
      }

      <div class="ac-card" style="margin-bottom:16px">
        <div class="ac-line"><span>Chu kỳ chạy</span><span>mỗi {{ s.runner.intervalMinutes }} phút</span></div>
        <div class="ac-line"><span>Lần chạy cuối</span><span>{{ time(s.runner.lastRunAt) }}</span></div>
        <div class="ac-line">
          <span>Kết quả</span>
          <span class="ac-badge" [class.bad]="s.runner.lastRunOk === false">
            {{ s.runner.lastRunOk === null ? 'Chưa chạy' : s.runner.lastRunOk ? 'Thành công' : 'Có lỗi' }}
          </span>
        </div>
        @if (s.runner.lastResult; as r) {
          <div class="ac-line"><span>Đã gửi / Bồi thường / Đóng</span><span>{{ r.submittedCount }} / {{ r.payoutCount }} / {{ r.expiredCount }}</span></div>
        }
      </div>

      <div class="ac-row">
        <button class="ac-btn" [disabled]="busy()" (click)="run(false)">Chạy oracle ngay</button>
        <button class="ac-btn ghost" [disabled]="busy()" (click)="run(true)">Chỉ chạy payout/expire</button>
      </div>

      @if (lastRun(); as r) {
        <div class="ac-alert" [class.ok]="r.errors.length === 0" [class.warn]="r.errors.length > 0">
          Đã gửi {{ r.submittedCount }} dữ liệu, bồi thường {{ r.payoutCount }}, đóng {{ r.expiredCount }} policy.
          @for (er of r.errors; track $index) { <div>• {{ er }}</div> }
        </div>
      }

      <div class="ac-table-wrap">
        <table class="ac-table">
          <thead>
            <tr><th>Vùng</th><th>Rủi ro</th><th>Policy</th><th>Giá trị</th><th>Tuổi dữ liệu</th><th>Giao dịch</th><th>Trạng thái</th></tr>
          </thead>
          <tbody>
            @for (i of s.items; track i.regionId + i.perilType) {
              <tr>
                <td class="ac-mono" [title]="i.regionId">{{ short(i.regionId) }}</td>
                <td>{{ peril(i.perilType) }}</td>
                <td>{{ i.activePolicies }}</td>
                <td>{{ value(i.lastValueScaled, i.perilType) }}</td>
                <td>{{ age(i.ageMinutes) }}</td>
                <td>
                  @if (url(i.lastTxHash); as u) { <a [href]="u" target="_blank" rel="noopener">{{ short(i.lastTxHash) }}</a> }
                  @else { <span class="ac-mono">{{ short(i.lastTxHash) }}</span> }
                </td>
                <td>
                  <span class="ac-badge" [class.bad]="i.lastStatus === 'error'" [title]="i.lastError ?? ''">
                    {{ i.lastStatus === 'ok' ? 'OK' : i.lastStatus === 'error' ? 'Lỗi' : '—' }}
                  </span>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="ac-muted">Chưa có policy đang hiệu lực nên chưa có vùng nào cần dữ liệu.</td></tr>
            }
          </tbody>
        </table>
      </div>

      @if (s.simulateEnabled && !simulateHidden()) {
        <h2 class="ac-sec">Giả lập thời tiết (demo)</h2>
        <p class="ac-muted">
          Ghi giá trị giả lên oracle. Lần chạy oracle định kỳ kế tiếp sẽ ghi đè bằng dữ liệu thật —
          khi demo hãy giả lập rồi bấm “Chỉ chạy payout/expire”.
        </p>
        <div class="ac-form">
          <label class="ac-field">Cách chọn vùng
            <select (change)="mode.set($any($event.target).value)">
              <option value="region" [selected]="mode() === 'region'">Vùng đang có policy</option>
              <option value="coords" [selected]="mode() === 'coords'">Nhập toạ độ</option>
            </select>
          </label>
          @if (mode() === 'region') {
            <label class="ac-field">Vùng
              <select (change)="regionId.set($any($event.target).value)">
                <option value="">— chọn —</option>
                @for (r of regionOptions(); track r) {
                  <option [value]="r" [selected]="regionId() === r">{{ short(r) }}</option>
                }
              </select>
            </label>
          } @else {
            <label class="ac-field">Vĩ độ (lat)
              <input type="number" step="any" [value]="lat()" (input)="lat.set($any($event.target).value)" />
            </label>
            <label class="ac-field">Kinh độ (lng)
              <input type="number" step="any" [value]="lng()" (input)="lng.set($any($event.target).value)" />
            </label>
          }
          <label class="ac-field">Loại rủi ro
            <select (change)="simPeril.set(+$any($event.target).value)">
              @for (l of perilLabels; track $index) {
                <option [value]="$index" [selected]="simPeril() === $index">{{ l }}</option>
              }
            </select>
          </label>
          <label class="ac-field">Giá trị ({{ simPeril() === 2 ? 'km/h' : 'mm' }})
            <input type="number" min="0" step="any" [value]="simValue()" (input)="simValue.set($any($event.target).value)" />
          </label>
        </div>
        <div class="ac-row" style="margin-top:12px">
          <button class="ac-btn" [disabled]="busy()" (click)="simulate(false)">Giả lập</button>
          <button class="ac-btn ghost" [disabled]="busy()" (click)="simulate(true)">Giả lập rồi chạy payout/expire</button>
        </div>
      }
    } @else if (!error()) {
      <p class="ac-muted">Đang tải…</p>
    }
  `,
})
export class AdminOracle {
  private readonly api = inject(AdminChainApi);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly perilLabels = PERIL_LABELS;
  readonly status = signal<OracleStatus | null>(null);
  readonly lastRun = signal<CycleResult | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly simulateHidden = signal(false);

  readonly mode = signal<'region' | 'coords'>('region');
  readonly regionId = signal('');
  readonly lat = signal('10.0452');
  readonly lng = signal('105.7469');
  readonly simPeril = signal(0);
  readonly simValue = signal('20');

  readonly regionOptions = computed(() => [...new Set((this.status()?.items ?? []).map((i) => i.regionId))]);

  readonly time = fmtTime;
  readonly age = fmtAge;
  readonly value = fmtOracleValue;
  readonly peril = perilLabel;
  readonly short = (h: string | null) => shortHex(h, 8, 6);
  readonly short2 = (h: string | null) => shortHex(h, 8, 6);
  readonly url = txUrl;

  constructor() {
    if (!this.isBrowser) return;
    void this.load();
    const timer = setInterval(() => void this.load(), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async load(): Promise<void> {
    try {
      this.status.set(await this.api.oracleStatus());
      this.error.set(null);
    } catch (e) {
      this.error.set(errMsg(e, 'Không tải được trạng thái oracle'));
    }
  }

  async run(skipWeather: boolean): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.api.runOracle(skipWeather);
      this.lastRun.set(r);
      this.toast.success(skipWeather ? 'Đã chạy payout/expire' : 'Đã chạy oracle');
      await this.load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) this.toast.warning('Oracle đang chạy, thử lại sau vài giây');
      else this.toast.error(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async simulate(thenRun: boolean): Promise<void> {
    const value = Number(this.simValue());
    if (!(value >= 0) || this.simValue() === '') {
      this.toast.error('Giá trị không hợp lệ');
      return;
    }
    const body =
      this.mode() === 'region'
        ? { regionId: this.regionId(), perilType: this.simPeril(), value }
        : { lat: Number(this.lat()), lng: Number(this.lng()), perilType: this.simPeril(), value };
    if (this.mode() === 'region' && !this.regionId()) {
      this.toast.error('Hãy chọn vùng');
      return;
    }

    this.busy.set(true);
    try {
      await this.api.simulate(body);
      this.toast.success('Đã ghi dữ liệu giả lập lên oracle');
      if (thenRun) {
        this.lastRun.set(await this.api.runOracle(true));
      }
      await this.load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        this.simulateHidden.set(true);
        this.toast.error('Giả lập đang bị tắt trên máy chủ (Demo:EnableSimulate)');
      } else if (e instanceof ApiError && e.status === 409) {
        this.toast.warning('Oracle đang chạy, thử lại sau vài giây');
      } else {
        this.toast.error(errMsg(e));
      }
    } finally {
      this.busy.set(false);
    }
  }
}
