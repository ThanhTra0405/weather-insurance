import { Component, PLATFORM_ID, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { formatEther, parseEther } from 'ethers';
import { ApiService } from '../../services/api.service';
import { ContractService, PoolStats } from '../../services/contract.service';
import { ToastService } from '../../services/toast.service';
import { Web3Service } from '../../services/web3.service';
import { fmtEth, fmtTime, shortHex, txUrl } from '../admin-chain/ac-utils';

interface LpHistoryItem {
  type: 'added' | 'withdrawn';
  amountWei: string;
  txHash: string;
  time: number;
}

/** Trang góp vốn / rút vốn cho nhà đầu tư (LP). Ví lấy từ Web3Service. */
@Component({
  selector: 'app-lp',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  styleUrl: '../admin-chain/ac-shared.css',
  template: `
    <div class="ac-wrap">
      <h1 class="ac-h1">Góp vốn vào quỹ bảo hiểm</h1>
      <p class="ac-sub">
        Vốn góp dùng để chi trả bồi thường. Bạn nhận phần phí bảo hiểm tương ứng với số share nắm giữ.
        Chỉ rút được phần vốn chưa bị khoá cho các policy đang hiệu lực.
      </p>

      @if (loadError()) {
        <div class="ac-alert err">{{ loadError() }}</div>
      }

      @if (stats(); as s) {
        <div class="ac-grid">
          <div class="ac-card"><h3>Số dư quỹ</h3><div class="ac-big">{{ eth(s.balance) }} ETH</div></div>
          <div class="ac-card"><h3>Tổng vốn góp</h3><div class="ac-big">{{ eth(s.deposited) }} ETH</div></div>
          <div class="ac-card"><h3>Đang khoá</h3><div class="ac-big">{{ eth(s.locked) }} ETH</div></div>
          <div class="ac-card"><h3>Khả dụng</h3><div class="ac-big">{{ eth(s.available) }} ETH</div></div>
        </div>

        <div class="ac-card" style="margin-bottom:16px">
          <h3>Phần của bạn</h3>
          <div class="ac-line"><span>Số share</span><span>{{ eth(myShares(), 6) }}</span></div>
          <div class="ac-line"><span>Giá trị ước tính</span><span>{{ eth(myValue(), 6) }} ETH</span></div>
          <div class="ac-line"><span>Tối đa rút được hiện tại</span><span>{{ eth(maxWithdrawValue(), 6) }} ETH</span></div>
          <div class="ac-line"><span>Số dư ví</span><span>{{ web3.balance() ?? '—' }} ETH</span></div>
        </div>
      } @else if (!loadError()) {
        <p class="ac-muted">Đang tải…</p>
      }

      @if (message(); as m) {
        <div class="ac-alert" [class.ok]="m.ok" [class.err]="!m.ok">
          {{ m.text }}
          @if (m.tx) {
            @if (url(m.tx); as u) { <a [href]="u" target="_blank" rel="noopener">{{ short(m.tx) }}</a> }
            @else { <span class="ac-mono">{{ short(m.tx) }}</span> }
          }
        </div>
      }

      <div class="ac-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div class="ac-card">
          <h3>Góp vốn</h3>
          <label class="ac-field">Số ETH
            <input type="number" min="0" step="any" [value]="depositEth()" (input)="depositEth.set($any($event.target).value)" />
          </label>
          <div class="ac-row" style="margin-top:12px">
            <button class="ac-btn" [disabled]="busy() || !canDeposit()" (click)="deposit()">
              {{ busy() ? 'Đang xử lý…' : 'Góp vốn' }}
            </button>
          </div>
        </div>

        <div class="ac-card">
          <h3>Rút vốn</h3>
          <label class="ac-field">Số share muốn rút
            <input type="number" min="0" step="any" [value]="withdrawShares()" (input)="withdrawShares.set($any($event.target).value)" />
          </label>
          <div class="ac-row" style="margin-top:8px">
            @for (p of percents; track p) {
              <button class="ac-btn ghost sm" [disabled]="busy()" (click)="setPercent(p)">{{ p }}%</button>
            }
          </div>
          <div class="ac-row">
            <button class="ac-btn" [disabled]="busy() || !canWithdraw()" (click)="withdraw()">
              {{ busy() ? 'Đang xử lý…' : 'Rút vốn' }}
            </button>
          </div>
        </div>
      </div>

      <h2 class="ac-sec">Lịch sử góp/rút của bạn</h2>
      <div class="ac-table-wrap">
        <table class="ac-table">
          <thead><tr><th>Thời gian</th><th>Loại</th><th>Số tiền (ETH)</th><th>Giao dịch</th></tr></thead>
          <tbody>
            @for (h of history(); track h.txHash) {
              <tr>
                <td>{{ time(h.time) }}</td>
                <td><span class="ac-badge" [class.off]="h.type === 'withdrawn'">{{ h.type === 'added' ? 'Góp vốn' : 'Rút vốn' }}</span></td>
                <td>{{ eth(h.amountWei, 6) }}</td>
                <td>
                  @if (url(h.txHash); as u) { <a [href]="u" target="_blank" rel="noopener">{{ short(h.txHash) }}</a> }
                  @else { <span class="ac-mono">{{ short(h.txHash) }}</span> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="ac-muted">Chưa có giao dịch nào.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class LiquidityPage {
  readonly web3 = inject(Web3Service);
  private readonly contracts = inject(ContractService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly percents = [25, 50, 75, 100];

  readonly stats = signal<PoolStats | null>(null);
  readonly myShares = signal(0n);
  readonly totalShares = signal(0n);
  readonly history = signal<LpHistoryItem[]>([]);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly message = signal<{ ok: boolean; text: string; tx?: string } | null>(null);

  readonly depositEth = signal('0.01');
  readonly withdrawShares = signal('');

  readonly eth = fmtEth;
  readonly time = fmtTime;
  readonly short = (h: string | null | undefined) => shortHex(h, 10, 8);
  readonly url = txUrl;

  /** Giá trị ước tính = shares * deposited / totalShares. */
  readonly myValue = computed(() => {
    const s = this.stats();
    const total = this.totalShares();
    return s && total > 0n ? (this.myShares() * s.deposited) / total : 0n;
  });

  /** Số share tối đa rút được ngay = min(share của tôi, vốn khả dụng quy ra share). */
  readonly maxWithdrawShares = computed(() => {
    const s = this.stats();
    if (!s || s.deposited === 0n) return 0n;
    const byAvailable = (s.available * this.totalShares()) / s.deposited;
    const mine = this.myShares();
    return mine < byAvailable ? mine : byAvailable;
  });

  readonly maxWithdrawValue = computed(() => {
    const s = this.stats();
    const total = this.totalShares();
    return s && total > 0n ? (this.maxWithdrawShares() * s.deposited) / total : 0n;
  });

  constructor() {
    effect(() => {
      if (this.isBrowser && this.web3.address()) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    const address = this.web3.address();
    if (!address) return;
    try {
      const [stats, shares, total] = await Promise.all([
        this.contracts.getPoolStats(),
        this.contracts.getMyShares(address),
        this.contracts.getTotalShares(),
      ]);
      this.stats.set(stats);
      this.myShares.set(shares);
      this.totalShares.set(total);
      this.loadError.set(null);
    } catch {
      this.loadError.set('Không đọc được dữ liệu quỹ từ blockchain, vui lòng thử lại sau');
    }
    void this.web3.refreshBalance();
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history.set(await this.api.get<LpHistoryItem[]>('/api/lp/history'));
    } catch {
      // lịch sử chỉ là phần phụ: lỗi thì giữ danh sách hiện có
    }
  }

  private parseAmount(text: string): bigint | null {
    try {
      const v = parseEther(text.trim());
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }

  canDeposit(): boolean {
    return this.parseAmount(this.depositEth()) !== null;
  }

  canWithdraw(): boolean {
    const v = this.parseAmount(this.withdrawShares());
    return v !== null && v <= this.myShares();
  }

  setPercent(percent: number): void {
    const shares = percent === 100 ? this.myShares() : (this.myShares() * BigInt(percent)) / 100n;
    this.withdrawShares.set(shares > 0n ? formatEther(shares) : '');
  }

  async deposit(): Promise<void> {
    const amount = this.parseAmount(this.depositEth());
    if (amount === null) return;

    const balance = this.web3.balance();
    if (balance !== null && Number(balance) < Number(formatEther(amount))) {
      this.message.set({ ok: false, text: 'Số dư ví không đủ để góp vốn (cần chừa thêm một ít cho phí gas).' });
      return;
    }
    await this.send(
      () => this.contracts.provideLiquidity(this.depositEth().trim()),
      'Góp vốn thành công',
      'added',
      amount,
    );
  }

  async withdraw(): Promise<void> {
    const shares = this.parseAmount(this.withdrawShares());
    if (shares === null) return;
    if (shares > this.maxWithdrawShares()) {
      this.message.set({
        ok: false,
        text: 'Vượt vốn khả dụng, phần còn lại đang bị khoá cho policy. Hãy rút ít hơn hoặc đợi policy kết thúc.',
      });
      return;
    }
    const total = this.totalShares();
    const stats = this.stats();
    const estimated = stats && total > 0n ? (shares * stats.deposited) / total : 0n;
    await this.send(() => this.contracts.withdrawLiquidity(shares), 'Rút vốn thành công', 'withdrawn', estimated);
  }

  private async send(
    action: () => Promise<{ hash: string }>,
    okText: string,
    type: LpHistoryItem['type'],
    amount: bigint,
  ): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      const receipt = await action();
      this.message.set({ ok: true, text: okText + '. Giao dịch:', tx: receipt.hash });
      this.toast.success(okText);
      // Hiện ngay bản ghi tạm; indexer sẽ ghi chính thức sau vài giây
      this.history.update((list) => [
        { type, amountWei: amount.toString(), txHash: receipt.hash, time: Math.floor(Date.now() / 1000) },
        ...list.filter((h) => h.txHash !== receipt.hash),
      ]);
      this.withdrawShares.set('');
      await this.load();
    } catch (e) {
      this.message.set({ ok: false, text: this.friendly(e) });
    } finally {
      this.busy.set(false);
    }
  }

  private friendly(e: unknown): string {
    const x = e as { reason?: string; shortMessage?: string; message?: string; info?: { error?: { message?: string } } };
    const raw = [x?.reason, x?.shortMessage, x?.info?.error?.message, x?.message].filter(Boolean).join(' | ');
    if (raw.includes('Vuot von kha dung')) return 'Vượt vốn khả dụng, phần còn lại đang bị khoá cho policy.';
    if (raw.includes('Khong du share')) return 'Số share muốn rút vượt quá số bạn đang có.';
    if (raw.includes('Khong co eth')) return 'Số ETH góp phải lớn hơn 0.';
    if (/EnforcedPause|paused/i.test(raw)) return 'Quỹ đang tạm dừng, vui lòng thử lại sau.';
    if (/insufficient funds/i.test(raw)) return 'Ví không đủ ETH (gồm cả phí gas).';
    if (/user rejected|denied/i.test(raw)) return 'Bạn đã huỷ giao dịch.';
    return 'Giao dịch thất bại, vui lòng thử lại.';
  }
}
