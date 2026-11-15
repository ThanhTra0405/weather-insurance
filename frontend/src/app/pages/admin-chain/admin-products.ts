import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiError } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { AdminChainApi, ProductRow } from './admin-chain.api';
import { PERIL_LABELS, errMsg, fmtEth, perilLabel, shortHex, txUrl } from './ac-utils';

@Component({
  selector: 'app-admin-products',
  standalone: true,
  template: `
    <h1 class="ac-h1">Sản phẩm bảo hiểm</h1>
    <p class="ac-sub">Thay đổi gửi giao dịch lên blockchain; bảng cập nhật sau vài giây khi indexer bắt kịp.</p>

    @if (error()) {
      <div class="ac-alert err">{{ error() }}</div>
    }
    @if (lastTx()) {
      <div class="ac-alert ok">
        Đã gửi giao dịch
        @if (url(lastTx()); as u) {
          <a [href]="u" target="_blank" rel="noopener">{{ short(lastTx()) }}</a>
        } @else {
          <span class="ac-mono">{{ short(lastTx()) }}</span>
        }
      </div>
    }

    <div class="ac-table-wrap">
      <table class="ac-table">
        <thead>
          <tr>
            <th>ID</th><th>Tên</th><th>Rủi ro</th><th>Ngưỡng</th><th>Thời hạn</th>
            <th>Phí (ETH)</th><th>Bồi thường (ETH)</th><th>Trạng thái</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (p of products(); track p.productId) {
            <tr>
              <td>{{ p.productId }}</td>
              <td>{{ p.name }}</td>
              <td>{{ perilName(p.perilType) }}</td>
              <td>{{ p.thresholdDisplay }}</td>
              <td>{{ p.durationDays }} ngày</td>
              <td>{{ eth(p.premiumWei, 6) }}</td>
              <td>{{ eth(p.coverageWei, 6) }}</td>
              <td><span class="ac-badge" [class.off]="!p.active">{{ p.active ? 'Đang bán' : 'Đã tắt' }}</span></td>
              <td>
                <button class="ac-btn ghost sm" [disabled]="busy()" (click)="toggle(p)">
                  {{ p.active ? 'Tắt' : 'Bật' }}
                </button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="9" class="ac-muted">Chưa có sản phẩm.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <h2 class="ac-sec">Tạo sản phẩm mới</h2>
    <div class="ac-form">
      <label class="ac-field">Tên
        <input [value]="name()" (input)="name.set(val($event))" maxlength="100" />
        @if (errors()['name']) { <span class="ac-err">{{ errors()['name'] }}</span> }
      </label>
      <label class="ac-field">Loại rủi ro
        <select (change)="peril.set(+val($event))">
          @for (l of perilLabels; track $index) {
            <option [value]="$index" [selected]="peril() === $index">{{ l }}</option>
          }
        </select>
      </label>
      <label class="ac-field">Ngưỡng ({{ peril() === 2 ? 'km/h' : 'mm' }})
        <input type="number" min="0" step="any" [value]="threshold()" (input)="threshold.set(val($event))" />
        @if (errors()['threshold']) { <span class="ac-err">{{ errors()['threshold'] }}</span> }
      </label>
      <label class="ac-field">Thời hạn (ngày)
        <input type="number" min="1" max="365" [value]="days()" (input)="days.set(val($event))" />
        @if (errors()['durationDays']) { <span class="ac-err">{{ errors()['durationDays'] }}</span> }
      </label>
      <label class="ac-field">Phí bảo hiểm (ETH)
        <input type="number" min="0" step="any" [value]="premium()" (input)="premium.set(val($event))" />
        @if (errors()['premiumEth']) { <span class="ac-err">{{ errors()['premiumEth'] }}</span> }
      </label>
      <label class="ac-field">Bồi thường (ETH)
        <input type="number" min="0" step="any" [value]="coverage()" (input)="coverage.set(val($event))" />
        @if (errors()['coverageEth']) { <span class="ac-err">{{ errors()['coverageEth'] }}</span> }
      </label>
      <button class="ac-btn" [disabled]="busy()" (click)="create()">Tạo sản phẩm</button>
    </div>
    <p class="ac-muted">
      Hạn hán: ngưỡng là tổng mưa 30 ngày (kích hoạt khi thấp hơn ngưỡng), thời hạn ≥ 30 ngày.
      Lũ: tổng mưa 3 ngày; Gió: gió giật cao nhất 3 ngày (kích hoạt khi cao hơn ngưỡng).
    </p>

    <h2 class="ac-sec">Cooling-off</h2>
    <div class="ac-row">
      <label class="ac-field">Số giây (0 – 604800)
        <input type="number" min="0" max="604800" [value]="cooling()" (input)="cooling.set(val($event))" />
      </label>
      <button class="ac-btn" [disabled]="busy()" (click)="saveCooling()">Cập nhật</button>
      @if (currentCooling() !== null) {
        <span class="ac-muted">Hiện tại: {{ currentCooling() }} giây</span>
      }
    </div>
  `,
})
export class AdminProducts {
  private readonly api = inject(AdminChainApi);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly perilLabels = PERIL_LABELS;
  readonly peril = signal(0);
  readonly name = signal('');
  readonly threshold = signal('150');
  readonly days = signal('90');
  readonly premium = signal('0.001');
  readonly coverage = signal('0.01');
  readonly cooling = signal('60');
  readonly currentCooling = signal<number | null>(null);

  readonly products = signal<ProductRow[]>([]);
  readonly errors = signal<Record<string, string>>({});
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly lastTx = signal<string | null>(null);

  readonly eth = fmtEth;
  readonly short = (h: string | null) => shortHex(h, 10, 8);
  readonly url = txUrl;

  constructor() {
    if (this.isBrowser) void this.load();
  }

  perilName(p: number): string {
    return perilLabel(p);
  }

  val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  private async load(): Promise<void> {
    try {
      const [products, sys] = await Promise.all([this.api.products(), this.api.system().catch(() => null)]);
      this.products.set(products);
      if (sys) {
        this.currentCooling.set(sys.coolingOffSeconds);
        this.cooling.set(String(sys.coolingOffSeconds));
      }
      this.error.set(null);
    } catch (e) {
      this.error.set(errMsg(e, 'Không tải được sản phẩm'));
    }
  }

  private reloadSoon(): void {
    // indexer cần vài giây để thấy giao dịch mới
    setTimeout(() => void this.load(), 15_000);
  }

  async toggle(p: ProductRow): Promise<void> {
    const verb = p.active ? 'tắt' : 'bật';
    if (!confirm(`Bạn muốn ${verb} sản phẩm "${p.name}"?`)) return;
    await this.run(async () => {
      const r = await this.api.setProductActive(p.productId, !p.active);
      this.lastTx.set(r.txHash);
      this.toast.success(`Đã gửi giao dịch ${verb} sản phẩm`);
    });
  }

  async saveCooling(): Promise<void> {
    const s = Number(this.cooling());
    if (!Number.isInteger(s) || s < 0 || s > 604800) {
      this.toast.error('Cooling-off phải là số nguyên từ 0 đến 604800 giây');
      return;
    }
    await this.run(async () => {
      const r = await this.api.setCoolingOff(s);
      this.lastTx.set(r.txHash);
      this.currentCooling.set(s);
      this.toast.success('Đã cập nhật cooling-off');
    });
  }

  async create(): Promise<void> {
    const f: Record<string, string> = {};
    const name = this.name().trim();
    const peril = this.peril();
    const threshold = Number(this.threshold());
    const days = Number(this.days());
    const premium = Number(this.premium());
    const coverage = Number(this.coverage());

    if (!name || name.length > 100) f['name'] = 'Tên 1–100 ký tự';
    if (!(threshold > 0)) f['threshold'] = 'Ngưỡng phải lớn hơn 0';
    if (!Number.isInteger(days) || days < 1 || days > 365) f['durationDays'] = 'Thời hạn 1–365 ngày';
    else if (peril === 0 && days < 30) f['durationDays'] = 'Hạn hán cần ít nhất 30 ngày';
    if (!(premium > 0)) f['premiumEth'] = 'Phí phải lớn hơn 0';
    if (!(coverage > premium)) f['coverageEth'] = 'Bồi thường phải lớn hơn phí';
    this.errors.set(f);
    if (Object.keys(f).length > 0) return;

    await this.run(async () => {
      const r = await this.api.createProduct({
        name,
        perilType: peril,
        threshold,
        durationDays: days,
        premiumEth: premium,
        coverageEth: coverage,
      });
      this.lastTx.set(r.txHash);
      this.name.set('');
      this.toast.success('Đã gửi giao dịch tạo sản phẩm');
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.reloadSoon();
    } catch (e) {
      if (e instanceof ApiError && e.fields) this.errors.set(e.fields);
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
