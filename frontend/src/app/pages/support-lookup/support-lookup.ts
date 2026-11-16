import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EvidenceViewerComponent } from '../../components/evidence-viewer/evidence-viewer';
import { SupportNavComponent } from '../../components/support-nav/support-nav';
import { TicketStatusChipComponent } from '../../components/ticket-status-chip/ticket-status-chip';
import { LookupItem, LookupKind, LookupResponse } from '../../models/ticket.models';
import { ApiError } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { StaffTicketService } from '../../services/staff-ticket.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatEth, formatVnDate, formatVnDateTime, perilIcon, perilLabel, policyStatusView } from '../../utils/format';

const KIND_LABELS: Record<LookupKind, string> = {
  wallet: 'địa chỉ ví',
  policy: 'mã policy',
  phone: 'số điện thoại',
  name: 'tên nông dân',
};

/** /support/lookup: tra cứu nông dân theo ví / policyId / số điện thoại / tên (SPEC-B mục 6.3 và 9.4.4). */
@Component({
  selector: 'app-support-lookup',
  standalone: true,
  imports: [RouterLink, SupportNavComponent, EvidenceViewerComponent, TicketStatusChipComponent],
  template: `
    <div class="container page">
      <div class="page-head">
        <div>
          <h1>Tra cứu nông dân</h1>
          <p class="page-sub">Nhập địa chỉ ví, mã policy, số điện thoại hoặc tên</p>
        </div>
      </div>
      <app-support-nav />

      <form class="card search" (submit)="onSubmit($event)">
        <label for="lk-q" class="sr-only">Từ khoá tra cứu</label>
        <input id="lk-q" type="search" autocomplete="off" placeholder="0x…, 12, 0912345678 hoặc Nguyễn Văn A" [value]="q()"
          (input)="q.set($any($event.target).value)" [disabled]="loading()" />
        <button type="submit" class="btn btn-primary" [disabled]="loading() || q().trim().length === 0">
          @if (loading()) { <span class="spinner" aria-hidden="true"></span> } Tra cứu
        </button>
      </form>

      @if (error(); as e) { <div class="alert alert-error" role="alert">{{ e }}</div> }

      @if (loading()) {
        <div class="card state-box" role="status"><span class="spinner" aria-hidden="true"></span> Đang tra cứu...</div>
      } @else if (result(); as r) {
        @if (r.items.length === 0) {
          <div class="card state-box">
            <p>Không tìm thấy nông dân nào theo {{ kindLabel(r.kind) }} "{{ r.query }}".</p>
            @if (r.kind === 'policy') { <p class="hint">Policy chưa tồn tại hoặc chưa gắn với hồ sơ nông dân đã đăng ký.</p> }
          </div>
        } @else {
          <p class="hint">{{ r.items.length }} kết quả theo {{ kindLabel(r.kind) }}@if (r.items.length === 20) { (hiển thị tối đa 20) }</p>
          <div class="results">
            @for (it of r.items; track it.profile.walletAddress) {
              <article class="card result">
                <button type="button" class="res-head" (click)="toggle(it.profile.walletAddress)"
                  [attr.aria-expanded]="isOpen(it.profile.walletAddress)">
                  <div>
                    <div class="name">{{ it.profile.fullName }}</div>
                    <div class="sub mono">{{ it.profile.walletAddress }}</div>
                  </div>
                  <div class="flags">
                    @if (it.evidenceSummary.exifWarning) { <span class="badge badge-pending">Cảnh báo EXIF</span> }
                    @if (it.openTickets.length > 0) { <span class="badge badge-paid">{{ it.openTickets.length }} ticket mở</span> }
                    <span class="caret" aria-hidden="true">{{ isOpen(it.profile.walletAddress) ? '▴' : '▾' }}</span>
                  </div>
                </button>

                @if (isOpen(it.profile.walletAddress)) {
                  <div class="detail">
                    <dl class="info">
                      <dt>Điện thoại</dt><dd>{{ it.profile.phone ?? '—' }}</dd>
                      <dt>Email</dt><dd>{{ it.profile.email ?? '—' }}</dd>
                      <dt>Địa chỉ</dt><dd>{{ it.profile.commune ? it.profile.commune + ', ' : '' }}{{ it.profile.district }}, {{ it.profile.province }}</dd>
                      <dt>Cây trồng</dt><dd>{{ it.profile.cropType }} · {{ it.profile.farmAreaHa }} ha</dd>
                      <dt>Đăng ký</dt><dd>{{ date(it.profile.createdAt) }}</dd>
                    </dl>
                    @if (!isAdmin()) { <p class="hint">Email và số điện thoại được che với tài khoản CSKH. Liên hệ nông dân qua ticket hoặc thông báo.</p> }

                    <h3>Policy ({{ it.policies.length }})</h3>
                    @if (it.policies.length === 0) {
                      <p class="muted-text">Chưa có policy nào.</p>
                    } @else {
                      <div class="pol-list">
                        @for (p of it.policies; track p.policyId) {
                          <div class="pol" [class.match]="r.matchedPolicyId === p.policyId">
                            <div class="pol-row">
                              <span class="pol-id">#{{ p.policyId }}</span>
                              <span>{{ icon(p.perilType) }} {{ p.productName ?? peril(p.perilType) }}</span>
                              <span class="badge" [class]="'badge ' + statusView(p).cls">{{ statusView(p).label }}</span>
                            </div>
                            <div class="pol-meta">
                              Phí {{ eth(p.premiumWei) }} ETH · Bồi thường {{ eth(p.coverageWei) }} ETH · {{ dateUnix(p.startTime) }} → {{ dateUnix(p.endTime) }}
                            </div>
                            @if (p.hasEvidence) { <app-evidence-viewer [policyId]="p.policyId" /> }
                            @else if (p.status === 0) { <p class="hint">Chưa gửi hồ sơ xác minh.</p> }
                          </div>
                        }
                      </div>
                    }

                    <h3>Ticket đang mở</h3>
                    @if (it.openTickets.length === 0) {
                      <p class="muted-text">Không có ticket đang mở.</p>
                    } @else {
                      <ul class="tickets">
                        @for (t of it.openTickets; track t.id) {
                          <li>
                            <a [routerLink]="['/support/ticket', t.id]">#{{ t.id }} · {{ t.subject }}</a>
                            <app-ticket-status-chip [status]="t.status" />
                            <span class="hint">{{ time(t.updatedAt) }}</span>
                          </li>
                        }
                      </ul>
                      <button type="button" class="btn btn-outline btn-sm" (click)="openLatest(it)">Tạo ghi chú nội bộ (ticket gần nhất)</button>
                    }
                  </div>
                }
              </article>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      .page { padding-top: 24px; padding-bottom: 48px; }
      .search { display: flex; gap: 10px; margin-bottom: 14px; padding: 14px; }
      .search input { flex: 1; }
      .hint { font-size: 12.5px; color: var(--color-text-muted); margin: 0 0 8px; }
      .results { display: grid; gap: 10px; }
      .result { padding: 0; overflow: hidden; }
      .res-head { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 16px; background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
      .res-head:hover { background: var(--color-bg-secondary); }
      .name { font-weight: 700; font-size: 16px; }
      .sub { font-size: 12.5px; color: var(--color-text-secondary); word-break: break-all; }
      .flags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .caret { color: var(--color-text-muted); }
      .detail { border-top: 1px solid var(--color-border); padding: 14px 16px; }
      h3 { font-size: 13px; margin: 14px 0 6px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
      .info { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; font-size: 14px; }
      .info dt { color: var(--color-text-secondary); }
      .info dd { margin: 0; font-weight: 600; word-break: break-word; }
      .muted-text { color: var(--color-text-secondary); font-size: 14px; margin: 0 0 8px; }
      .pol-list { display: grid; gap: 10px; }
      .pol { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 10px 12px; }
      .pol.match { border-color: var(--color-primary); background: var(--color-bg-secondary); }
      .pol-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; }
      .pol-id { font-weight: 700; color: var(--color-primary-dark); }
      .pol-meta { font-size: 12.5px; color: var(--color-text-secondary); margin: 4px 0 8px; }
      .tickets { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 6px; font-size: 14px; }
      .tickets li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      @media (max-width: 640px) { .search { flex-direction: column; } .res-head { align-items: flex-start; flex-direction: column; } .flags { justify-content: flex-start; } }
    `,
  ],
})
export class SupportLookupPage {
  private readonly svc = inject(StaffTicketService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly q = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<LookupResponse | null>(null);
  private readonly expanded = signal<Set<string>>(new Set());

  readonly isAdmin = () => this.auth.role() === 'admin';

  eth = formatEth;
  date = formatVnDate;
  time = formatVnDateTime;
  peril = perilLabel;
  icon = perilIcon;
  statusView = (p: { status: number; rejected: boolean }) => policyStatusView(p.status, p.rejected);
  kindLabel = (k: LookupKind): string => KIND_LABELS[k] ?? k;
  dateUnix = (unix: number): string => formatVnDate(unix);

  constructor() {
    // Mở từ trang khác với ?q= (ví dụ từ chi tiết ticket): tự tra cứu.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const q = params.get('q')?.trim() ?? '';
      if (q && q !== this.lastRun) {
        this.q.set(q);
        void this.run(q);
      }
    });
  }

  private lastRun = '';

  onSubmit(event: Event): void {
    event.preventDefault();
    const q = this.q().trim();
    if (!q || this.loading()) return;
    void this.router.navigate([], { queryParams: { q }, replaceUrl: true });
    void this.run(q);
  }

  private async run(q: string): Promise<void> {
    this.lastRun = q;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.svc.lookup(q);
      this.result.set(res);
      // Chỉ có một kết quả thì mở sẵn.
      this.expanded.set(new Set(res.items.length === 1 ? [res.items[0].profile.walletAddress] : []));
    } catch (e) {
      this.result.set(null);
      this.error.set(e instanceof ApiError && e.fields?.['q'] ? e.fields['q'] : errorMessage(e, 'Không tra cứu được, vui lòng thử lại'));
    } finally {
      this.loading.set(false);
    }
  }

  isOpen(wallet: string): boolean {
    return this.expanded().has(wallet);
  }

  toggle(wallet: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(wallet)) next.delete(wallet);
      else next.add(wallet);
      return next;
    });
  }

  /** Ticket đang mở được backend sắp theo cập nhật mới nhất, nên phần tử đầu là ticket gần nhất. */
  openLatest(item: LookupItem): void {
    const latest = item.openTickets[0];
    if (latest) void this.router.navigate(['/support/ticket', latest.id]);
  }
}
