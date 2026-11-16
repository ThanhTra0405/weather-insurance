import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { PageStateComponent } from '../../components/page-state/page-state';
import { AuditLogItem } from '../../models/ticket.models';
import { AdminStaffService } from '../../services/admin-staff.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatVnDateTime } from '../../utils/format';

const PAGE_SIZE = 50;

/** Tên tiếng Việt cho các action đã biết ở backend; action lạ hiển thị nguyên mã. */
const ACTION_LABELS: Record<string, string> = {
  register: 'Đăng ký tài khoản',
  login: 'Đăng nhập (nông dân)',
  staff_login: 'Đăng nhập (nhân viên)',
  staff_login_failed: 'Đăng nhập nhân viên thất bại',
  staff_change_password: 'Đổi mật khẩu nhân viên',
  staff_create: 'Tạo nhân viên',
  staff_update: 'Cập nhật nhân viên',
  review: 'Duyệt / từ chối hồ sơ',
};

const ACTOR_TYPE_LABELS: Record<string, string> = { staff: 'Nhân viên', farmer: 'Nông dân', system: 'Hệ thống' };

/** Đầu ngày / cuối ngày theo giờ Việt Nam, đổi sang ISO UTC (tránh ký tự "+" trong query string). */
function vnDayStart(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}
function vnDayEnd(date: string): string {
  return new Date(`${date}T23:59:59.999+07:00`).toISOString();
}

/** /admin/audit: nhật ký hoạt động, phân trang, lọc theo hành động / người thực hiện / khoảng ngày (SPEC-B mục 8 và 9.4.9). */
@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [PageStateComponent],
  template: `
    <div class="container page">
      <div class="page-head">
        <div>
          <h1>Nhật ký hoạt động</h1>
          <p class="page-sub">Mới nhất trước. Giờ hiển thị theo giờ Việt Nam.</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm" (click)="load()" [disabled]="loading()">↻ Tải lại</button>
      </div>

      <form class="card filters" (submit)="onSearch($event)">
        <div class="f">
          <label for="au-action">Hành động</label>
          <input id="au-action" type="text" placeholder="vd: review, staff_" [value]="action()" (input)="action.set($any($event.target).value)" />
        </div>
        <div class="f">
          <label for="au-actor">Người thực hiện</label>
          <input id="au-actor" type="text" placeholder="Tên, email nhân viên hoặc ví" [value]="actor()" (input)="actor.set($any($event.target).value)" />
        </div>
        <div class="f f-date">
          <label for="au-from">Từ ngày</label>
          <input id="au-from" type="date" [value]="from()" [attr.max]="to() || null" (input)="from.set($any($event.target).value)" />
        </div>
        <div class="f f-date">
          <label for="au-to">Đến ngày</label>
          <input id="au-to" type="date" [value]="to()" [attr.min]="from() || null" (input)="to.set($any($event.target).value)" />
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Lọc</button>
        @if (hasFilters()) { <button type="button" class="btn btn-outline btn-sm" (click)="clear()">Xoá lọc</button> }
      </form>

      @if (rangeError(); as re) { <div class="alert alert-warning" role="alert">{{ re }}</div> }

      <app-page-state [loading]="loading() && items().length === 0" [error]="error()"
        [empty]="!loading() && !error() && items().length === 0"
        [emptyText]="hasFilters() ? 'Không có bản ghi nào khớp bộ lọc.' : 'Chưa có hoạt động nào được ghi lại.'" (retry)="load()" />

      @if (items().length > 0) {
        <div class="table-wrap" [class.dim]="loading()">
          <table class="data-table">
            <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
            <tbody>
              @for (a of items(); track a.id) {
                <tr>
                  <td class="nowrap">{{ time(a.createdAt) }}</td>
                  <td>
                    <div class="strong">{{ actorName(a) }}</div>
                    <div class="hint">{{ actorType(a.actorType) }}</div>
                  </td>
                  <td>
                    <div>{{ actionLabel(a.action) }}</div>
                    <div class="hint mono">{{ a.action }}</div>
                  </td>
                  <td class="mono break">{{ a.target ?? '—' }}</td>
                  <td>
                    @if (hasDetail(a)) {
                      <button type="button" class="link-btn" (click)="toggle(a.id)" [attr.aria-expanded]="isOpen(a.id)">{{ isOpen(a.id) ? 'Ẩn' : 'Xem' }}</button>
                      @if (isOpen(a.id)) { <pre class="detail">{{ pretty(a.detail) }}</pre> }
                    } @else { — }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="pager">
          <span class="muted">{{ rangeText() }}</span>
          <div class="pager-btns">
            <button type="button" class="btn btn-outline btn-sm" (click)="goPage(page() - 1)" [disabled]="page() <= 1 || loading()">← Trước</button>
            <span class="muted">Trang {{ page() }} / {{ totalPages() }}</span>
            <button type="button" class="btn btn-outline btn-sm" (click)="goPage(page() + 1)" [disabled]="page() >= totalPages() || loading()">Sau →</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .page { padding-top: 24px; padding-bottom: 48px; }
      .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 14px; padding: 14px; }
      .f { flex: 1 1 170px; }
      .f-date { flex: 0 1 150px; }
      .f label { font-size: 12px; margin-bottom: 3px; }
      .filters input { padding: 8px 10px; font-size: 14px; }
      .dim { opacity: 0.6; pointer-events: none; }
      .nowrap { white-space: nowrap; }
      .strong { font-weight: 600; word-break: break-word; }
      .break { word-break: break-all; }
      .hint { font-size: 12px; color: var(--color-text-muted); }
      .detail { margin: 6px 0 0; padding: 8px 10px; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 12px; max-width: 340px; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
      .pager { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; font-size: 13.5px; }
      .pager-btns { display: flex; align-items: center; gap: 8px; }
      @media (max-width: 640px) { .pager { justify-content: center; } .f-date { flex: 1 1 140px; } }
    `,
  ],
})
export class AdminAuditPage implements OnInit {
  private readonly svc = inject(AdminStaffService);

  readonly action = signal('');
  readonly actor = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly page = signal(1);

  // Bộ lọc đã áp dụng (chỉ đổi khi bấm "Lọc", không gọi API theo từng phím gõ).
  private applied = { action: '', actor: '', from: '', to: '' };
  readonly hasFilters = signal(false);

  readonly items = signal<AuditLogItem[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rangeError = signal<string | null>(null);
  private readonly expanded = signal<Set<number>>(new Set());

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  readonly rangeText = computed(() => {
    const total = this.total();
    if (total === 0) return '0 bản ghi';
    const from = (this.page() - 1) * PAGE_SIZE + 1;
    return `${from}–${Math.min(total, from + PAGE_SIZE - 1)} / ${total} bản ghi`;
  });

  time = formatVnDateTime;
  actionLabel = (a: string): string => ACTION_LABELS[a] ?? a;
  actorType = (t: string): string => ACTOR_TYPE_LABELS[t] ?? t;

  ngOnInit(): void {
    void this.load();
  }

  actorName(a: AuditLogItem): string {
    if (a.actorName) return a.actorName;
    if (!a.actorRef) return a.actorType === 'system' ? 'Hệ thống' : '—';
    return a.actorRef.length > 14 ? `${a.actorRef.slice(0, 8)}…${a.actorRef.slice(-4)}` : a.actorRef;
  }

  hasDetail(a: AuditLogItem): boolean {
    return a.detail !== null && a.detail !== undefined;
  }

  pretty(detail: unknown): string {
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return String(detail);
    }
  }

  isOpen(id: number): boolean {
    return this.expanded().has(id);
  }

  toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  onSearch(event: Event): void {
    event.preventDefault();
    if (this.from() && this.to() && this.from() > this.to()) {
      this.rangeError.set('"Từ ngày" phải trước hoặc bằng "Đến ngày"');
      return;
    }
    this.rangeError.set(null);
    this.applied = { action: this.action().trim(), actor: this.actor().trim(), from: this.from(), to: this.to() };
    this.hasFilters.set(!!(this.applied.action || this.applied.actor || this.applied.from || this.applied.to));
    this.page.set(1);
    void this.load();
  }

  clear(): void {
    this.action.set('');
    this.actor.set('');
    this.from.set('');
    this.to.set('');
    this.rangeError.set(null);
    this.applied = { action: '', actor: '', from: '', to: '' };
    this.hasFilters.set(false);
    this.page.set(1);
    void this.load();
  }

  goPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.page.set(page);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.svc.audit({
        page: this.page(),
        pageSize: PAGE_SIZE,
        action: this.applied.action,
        actor: this.applied.actor,
        from: this.applied.from ? vnDayStart(this.applied.from) : undefined,
        to: this.applied.to ? vnDayEnd(this.applied.to) : undefined,
      });
      this.items.set(res.items);
      this.total.set(res.total);
      this.expanded.set(new Set());
    } catch (e) {
      this.error.set(errorMessage(e, 'Không tải được nhật ký hoạt động'));
    } finally {
      this.loading.set(false);
    }
  }
}
