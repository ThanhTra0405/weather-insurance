import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PageStateComponent } from '../../components/page-state/page-state';
import { SupportNavComponent } from '../../components/support-nav/support-nav';
import { TicketPriorityBadgeComponent } from '../../components/ticket-priority-badge/ticket-priority-badge';
import { TicketStatusChipComponent } from '../../components/ticket-status-chip/ticket-status-chip';
import { StaffTicketCounts, StaffTicketItem, TicketCategory, TicketPriority, TicketStatus } from '../../models/ticket.models';
import { StaffTicketService } from '../../services/staff-ticket.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatVnDateTime } from '../../utils/format';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, ticketCategoryLabel } from '../../utils/ticket-text';

type QueueTab = 'mine' | 'unassigned' | 'all';
const PAGE_SIZE = 20;

/** /support: hàng đợi ticket cho CSKH và admin (SPEC-B mục 9.4.2). */
@Component({
  selector: 'app-support-home',
  standalone: true,
  imports: [RouterLink, SupportNavComponent, PageStateComponent, TicketStatusChipComponent, TicketPriorityBadgeComponent],
  template: `
    <div class="container page">
      <div class="page-head">
        <div>
          <h1>Hỗ trợ khách hàng</h1>
          <p class="page-sub">Hàng đợi yêu cầu từ nông dân</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm" (click)="load()" [disabled]="loading()">↻ Tải lại</button>
      </div>

      <app-support-nav />

      <div class="pill-tabs" role="tablist" aria-label="Phạm vi hàng đợi">
        @for (t of tabs; track t.key) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.key" [class.active]="tab() === t.key" (click)="setTab(t.key)">
            {{ t.label }} <span class="count">{{ countOf(t.key) }}</span>
          </button>
        }
      </div>

      <form class="card filters" (submit)="onSearch($event)">
        <div class="f-search">
          <label for="q" class="sr-only">Tìm kiếm</label>
          <input id="q" type="search" placeholder="Tìm theo chủ đề, ví, mã policy, số điện thoại..." [value]="qDraft()"
            (input)="qDraft.set($any($event.target).value)" />
        </div>
        <div class="f-sel">
          <label for="f-status">Trạng thái</label>
          <select id="f-status" (change)="setFilter('status', $any($event.target).value)">
            <option value="" [selected]="status() === ''">Tất cả</option>
            @for (s of statuses; track s.value) { <option [value]="s.value" [selected]="status() === s.value">{{ s.label }}</option> }
          </select>
        </div>
        <div class="f-sel">
          <label for="f-cat">Loại</label>
          <select id="f-cat" (change)="setFilter('category', $any($event.target).value)">
            <option value="" [selected]="category() === ''">Tất cả</option>
            @for (c of categories; track c.value) { <option [value]="c.value" [selected]="category() === c.value">{{ c.label }}</option> }
          </select>
        </div>
        <div class="f-sel">
          <label for="f-prio">Ưu tiên</label>
          <select id="f-prio" (change)="setFilter('priority', $any($event.target).value)">
            <option value="" [selected]="priority() === ''">Tất cả</option>
            @for (p of priorities; track p.value) { <option [value]="p.value" [selected]="priority() === p.value">{{ p.label }}</option> }
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Tìm</button>
        @if (hasFilters()) { <button type="button" class="btn btn-outline btn-sm" (click)="clearFilters()">Xoá lọc</button> }
      </form>

      <app-page-state [loading]="loading() && items().length === 0" [error]="error()"
        [empty]="!loading() && !error() && items().length === 0"
        [emptyText]="hasFilters() ? 'Không có yêu cầu nào khớp bộ lọc.' : 'Hàng đợi đang trống.'" (retry)="load()" />

      @if (items().length > 0) {
        <div class="table-wrap" [class.dim]="loading()">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th><th>Thời gian</th><th>Nông dân</th><th>Chủ đề</th><th>Loại</th>
                <th>Ưu tiên</th><th>Trạng thái</th><th>Người xử lý</th><th>Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              @for (t of items(); track t.id) {
                <tr class="row" (click)="open(t.id)">
                  <td><a [routerLink]="['/support/ticket', t.id]" (click)="$event.stopPropagation()">#{{ t.id }}</a></td>
                  <td class="nowrap">{{ time(t.createdAt) }}</td>
                  <td>{{ t.farmerName ?? '—' }}</td>
                  <td class="subject-cell">
                    <div class="subject">{{ t.subject }}</div>
                    @if (t.lastMessagePreview) {
                      <div class="preview">{{ t.lastSenderType === 'farmer' ? 'Nông dân' : 'CSKH' }}: {{ t.lastMessagePreview }}</div>
                    }
                  </td>
                  <td>{{ categoryLabel(t.category) }}</td>
                  <td><app-ticket-priority-badge [priority]="t.priority" /></td>
                  <td><app-ticket-status-chip [status]="t.status" /></td>
                  <td>{{ t.assignedToName ?? 'Chưa gán' }}</td>
                  <td class="nowrap">{{ time(t.updatedAt) }}</td>
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
      .count { opacity: 0.8; margin-left: 2px; }
      .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 14px; padding: 14px; }
      .f-search { flex: 2 1 240px; }
      .f-sel { flex: 1 1 130px; }
      .f-sel label { font-size: 12px; margin-bottom: 3px; }
      .filters input, .filters select { padding: 8px 10px; font-size: 14px; }
      .dim { opacity: 0.6; pointer-events: none; }
      .row { cursor: pointer; }
      .nowrap { white-space: nowrap; }
      .subject-cell { min-width: 220px; max-width: 360px; }
      .subject { font-weight: 600; word-break: break-word; }
      .preview { font-size: 12.5px; color: var(--color-text-secondary); margin-top: 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
      .pager { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; font-size: 13.5px; }
      .pager-btns { display: flex; align-items: center; gap: 8px; }
      @media (max-width: 640px) { .pager { justify-content: center; } }
    `,
  ],
})
export class SupportHome implements OnInit {
  private readonly svc = inject(StaffTicketService);
  private readonly router = inject(Router);

  readonly tabs: { key: QueueTab; label: string }[] = [
    { key: 'mine', label: 'Của tôi' },
    { key: 'unassigned', label: 'Chưa gán' },
    { key: 'all', label: 'Tất cả' },
  ];
  readonly statuses = TICKET_STATUSES;
  readonly categories = TICKET_CATEGORIES;
  readonly priorities = TICKET_PRIORITIES;

  readonly tab = signal<QueueTab>('all');
  readonly status = signal<TicketStatus | ''>('');
  readonly category = signal<TicketCategory | ''>('');
  readonly priority = signal<TicketPriority | ''>('');
  readonly qDraft = signal('');
  private readonly q = signal('');
  readonly page = signal(1);

  readonly items = signal<StaffTicketItem[]>([]);
  readonly total = signal(0);
  readonly counts = signal<StaffTicketCounts>({ mine: 0, unassigned: 0, all: 0 });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  readonly hasFilters = computed(() => !!(this.status() || this.category() || this.priority() || this.q()));
  readonly rangeText = computed(() => {
    const total = this.total();
    if (total === 0) return '0 yêu cầu';
    const from = (this.page() - 1) * PAGE_SIZE + 1;
    return `${from}–${Math.min(total, from + PAGE_SIZE - 1)} / ${total} yêu cầu`;
  });

  time = formatVnDateTime;
  categoryLabel = ticketCategoryLabel;

  ngOnInit(): void {
    void this.load();
  }

  countOf(tab: QueueTab): number {
    return this.counts()[tab];
  }

  setTab(tab: QueueTab): void {
    this.tab.set(tab);
    this.page.set(1);
    void this.load();
  }

  setFilter(kind: 'status' | 'category' | 'priority', value: string): void {
    if (kind === 'status') this.status.set(value as TicketStatus | '');
    else if (kind === 'category') this.category.set(value as TicketCategory | '');
    else this.priority.set(value as TicketPriority | '');
    this.page.set(1);
    void this.load();
  }

  onSearch(event: Event): void {
    event.preventDefault();
    this.q.set(this.qDraft().trim());
    this.page.set(1);
    void this.load();
  }

  clearFilters(): void {
    this.status.set('');
    this.category.set('');
    this.priority.set('');
    this.q.set('');
    this.qDraft.set('');
    this.page.set(1);
    void this.load();
  }

  goPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.page.set(page);
    void this.load();
  }

  open(id: number): void {
    void this.router.navigate(['/support/ticket', id]);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const tab = this.tab();
      const res = await this.svc.queue({
        status: this.status(),
        category: this.category(),
        priority: this.priority(),
        q: this.q(),
        assignedTo: tab === 'all' ? undefined : tab === 'mine' ? 'me' : 'unassigned',
        page: this.page(),
        pageSize: PAGE_SIZE,
      });
      this.items.set(res.items);
      this.total.set(res.total);
      if (res.counts) this.counts.set(res.counts);
    } catch (e) {
      this.error.set(errorMessage(e, 'Không tải được hàng đợi ticket'));
    } finally {
      this.loading.set(false);
    }
  }
}
