import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AdminChainApi, PayoutPage } from './admin-chain.api';
import { errMsg, fmtEth, fmtTime, shortHex, txUrl } from './ac-utils';

@Component({
  selector: 'app-admin-payouts',
  standalone: true,
  template: `
    <h1 class="ac-h1">Lịch sử bồi thường</h1>

    @if (error()) {
      <div class="ac-alert err">{{ error() }}</div>
    }

    @if (data(); as d) {
      <p class="ac-sub">Tổng {{ d.count }} lượt — {{ eth(d.totalWei, 6) }} ETH</p>
      <div class="ac-table-wrap">
        <table class="ac-table">
          <thead><tr><th>Thời gian</th><th>Policy</th><th>Người nhận</th><th>Số tiền (ETH)</th><th>Giao dịch</th></tr></thead>
          <tbody>
            @for (p of d.items; track p.txHash) {
              <tr>
                <td>{{ time(p.time) }}</td>
                <td>#{{ p.policyId }}</td>
                <td class="ac-mono" [title]="p.holder ?? ''">{{ short(p.holder) }}</td>
                <td>{{ eth(p.amountWei, 6) }}</td>
                <td>
                  @if (url(p.txHash); as u) { <a [href]="u" target="_blank" rel="noopener">{{ short(p.txHash) }}</a> }
                  @else { <span class="ac-mono">{{ short(p.txHash) }}</span> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="ac-muted">Chưa có lượt bồi thường nào.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <div class="ac-row">
        <button class="ac-btn ghost sm" [disabled]="d.page <= 1 || loading()" (click)="go(d.page - 1)">← Trước</button>
        <span class="ac-muted">Trang {{ d.page }} / {{ pages(d) }}</span>
        <button class="ac-btn ghost sm" [disabled]="d.page >= pages(d) || loading()" (click)="go(d.page + 1)">Sau →</button>
      </div>
    } @else if (!error()) {
      <p class="ac-muted">Đang tải…</p>
    }
  `,
})
export class AdminPayouts {
  private readonly api = inject(AdminChainApi);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly data = signal<PayoutPage | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  readonly eth = fmtEth;
  readonly time = fmtTime;
  readonly short = (h: string | null) => shortHex(h, 8, 6);
  readonly url = txUrl;

  constructor() {
    if (this.isBrowser) void this.go(1);
  }

  pages(d: PayoutPage): number {
    return Math.max(1, Math.ceil(d.count / d.pageSize));
  }

  async go(page: number): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.api.payouts(page));
      this.error.set(null);
    } catch (e) {
      this.error.set(errMsg(e, 'Không tải được lịch sử bồi thường'));
    } finally {
      this.loading.set(false);
    }
  }
}
