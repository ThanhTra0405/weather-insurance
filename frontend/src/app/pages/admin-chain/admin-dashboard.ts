import { Component, DestroyRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminChainApi, AdminStats } from './admin-chain.api';
import { errMsg, fmtEth, fmtTime, isLow } from './ac-utils';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1 class="ac-h1">Tổng quan hệ thống</h1>
    <p class="ac-sub">Tự làm mới mỗi 30 giây.</p>

    @if (error()) {
      <div class="ac-alert err">{{ error() }}</div>
    }

    @if (stats(); as s) {
      @if (s.chainError) {
        <div class="ac-alert warn">{{ s.chainError }} — số liệu pool và số dư có thể chưa chính xác.</div>
      }

      <div class="ac-grid">
        <div class="ac-card">
          <h3>Policy</h3>
          <div class="ac-big">{{ s.policies.total }}</div>
          <div class="ac-line"><span>Chờ duyệt</span><span>{{ s.policies.pending }}</span></div>
          <div class="ac-line"><span>Đang hiệu lực</span><span>{{ s.policies.active }}</span></div>
          <div class="ac-line"><span>Đã bồi thường</span><span>{{ s.policies.paidOut }}</span></div>
          <div class="ac-line"><span>Đã đóng</span><span>{{ s.policies.closed }}</span></div>
        </div>

        <div class="ac-card">
          <h3>Hồ sơ chờ duyệt</h3>
          <div class="ac-big">{{ s.policies.pending }}</div>
          <a routerLink="/admin/review">Mở trang duyệt →</a>
        </div>

        <div class="ac-card">
          <h3>Quỹ (pool)</h3>
          <div class="ac-line"><span>Số dư</span><span>{{ eth(s.pool.balanceWei) }} ETH</span></div>
          <div class="ac-line"><span>Đang khoá</span><span>{{ eth(s.pool.lockedWei) }} ETH</span></div>
          <div class="ac-line"><span>Khả dụng</span><span>{{ eth(s.pool.availableWei) }} ETH</span></div>
        </div>

        <div class="ac-card">
          <h3>Tổng bồi thường</h3>
          <div class="ac-big">{{ eth(s.payouts.totalWei) }} ETH</div>
          <div class="ac-muted">{{ s.payouts.count }} lượt</div>
        </div>

        <div class="ac-card">
          <h3>Ticket</h3>
          <div class="ac-line"><span>Mở</span><span>{{ s.tickets.open }}</span></div>
          <div class="ac-line"><span>Đang xử lý</span><span>{{ s.tickets.inProgress }}</span></div>
          <div class="ac-line"><span>Chưa gán</span><span>{{ s.tickets.unassigned }}</span></div>
        </div>

        <div class="ac-card" [class.ac-warn]="low(s.operatorBalanceWei)">
          <h3>Số dư operator</h3>
          <div class="ac-big">{{ eth(s.operatorBalanceWei) }} ETH</div>
          @if (low(s.operatorBalanceWei)) {
            <div class="ac-muted">Sắp hết gas, cần nạp thêm Sepolia ETH</div>
          }
        </div>

        <div class="ac-card" [class.ac-warn]="low(s.faucetBalanceWei)">
          <h3>Số dư faucet</h3>
          <div class="ac-big">{{ eth(s.faucetBalanceWei) }} ETH</div>
          @if (low(s.faucetBalanceWei)) {
            <div class="ac-muted">Faucet sắp cạn, nông dân mới sẽ không nhận được ETH</div>
          }
        </div>

        <div class="ac-card" [class.ac-warn]="!s.oracle.lastRunOk">
          <h3>Oracle</h3>
          <div class="ac-line"><span>Lần chạy cuối</span><span>{{ time(s.oracle.lastRunAt) }}</span></div>
          <div class="ac-line">
            <span>Kết quả</span>
            <span>{{ s.oracle.lastRunAt ? (s.oracle.lastRunOk ? 'Thành công' : 'Có lỗi') : '—' }}</span>
          </div>
          <a routerLink="/admin/oracle">Chi tiết →</a>
        </div>

        <div class="ac-card" [class.ac-warn]="s.indexer.lag > 50">
          <h3>Indexer</h3>
          <div class="ac-line"><span>Block đã xử lý</span><span>{{ s.indexer.lastBlock }}</span></div>
          <div class="ac-line"><span>Block mới nhất</span><span>{{ s.indexer.latestBlock }}</span></div>
          <div class="ac-line"><span>Độ trễ</span><span>{{ s.indexer.lag }} block</span></div>
        </div>
      </div>
    } @else if (!error()) {
      <p class="ac-muted">Đang tải…</p>
    }
  `,
})
export class AdminDashboard {
  private readonly api = inject(AdminChainApi);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly stats = signal<AdminStats | null>(null);
  readonly error = signal<string | null>(null);

  readonly eth = fmtEth;
  readonly low = isLow;
  readonly time = fmtTime;

  constructor() {
    if (!this.isBrowser) return;
    void this.load();
    const timer = setInterval(() => void this.load(), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async load(): Promise<void> {
    try {
      this.stats.set(await this.api.stats());
      this.error.set(null);
    } catch (e) {
      this.error.set(errMsg(e, 'Không tải được số liệu'));
    }
  }
}
