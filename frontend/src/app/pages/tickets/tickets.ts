import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TicketStatusChipComponent } from '../../components/ticket-status-chip/ticket-status-chip';
import { TicketListItem } from '../../models/ticket.models';
import { TicketService } from '../../services/ticket.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatVnDateTime } from '../../utils/format';
import { isTicketOpen, ticketCategoryLabel } from '../../utils/ticket-text';

type Tab = 'all' | 'open' | 'done';
const PAGE_SIZE = 50;

/** /tickets: danh sách yêu cầu hỗ trợ của tôi, mới cập nhật trước (SPEC-B mục 9.3.5). */
@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [RouterLink, TicketStatusChipComponent],
  template: `
    <div class="container page">
      <div class="head">
        <h1>Hỗ trợ</h1>
        <a routerLink="/tickets/new" class="btn btn-primary">+ Tạo yêu cầu</a>
      </div>

      <div class="tabs" role="tablist" aria-label="Lọc yêu cầu">
        @for (t of tabs; track t.key) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.key" [class.active]="tab() === t.key" (click)="tab.set(t.key)">
            {{ t.label }} <span class="count">{{ countOf(t.key) }}</span>
          </button>
        }
      </div>

      @if (error(); as e) {
        <div class="alert alert-error" role="alert">
          {{ e }} <button type="button" class="link-btn" (click)="load(true)">Thử lại</button>
        </div>
      }

      @if (loading() && items().length === 0) {
        <div class="card"><p class="muted"><span class="spinner" aria-hidden="true"></span> Đang tải...</p></div>
      } @else if (visible().length === 0 && !error()) {
        <div class="card empty">
          <p>{{ items().length === 0 ? 'Bạn chưa có yêu cầu hỗ trợ nào.' : 'Không có yêu cầu nào trong mục này.' }}</p>
          <a routerLink="/tickets/new" class="btn btn-primary">Tạo yêu cầu</a>
        </div>
      } @else {
        <ul class="list">
          @for (t of visible(); track t.id) {
            <li>
              <a class="item card" [routerLink]="['/tickets', t.id]" [class.attention]="t.status === 'waiting_customer'">
                <div class="top">
                  <span class="subject">{{ t.subject }}</span>
                  <app-ticket-status-chip [status]="t.status" />
                </div>
                <div class="meta">
                  #{{ t.id }} · {{ category(t.category) }}@if (t.policyId) { · Policy #{{ t.policyId }} }
                </div>
                @if (t.lastMessagePreview) {
                  <div class="preview">
                    <span class="who">{{ t.lastSenderType === 'staff' ? 'CSKH' : 'Bạn' }}:</span> {{ t.lastMessagePreview }}
                  </div>
                }
                <div class="time">Cập nhật {{ time(t.updatedAt) }}</div>
              </a>
            </li>
          }
        </ul>

        @if (items().length < total()) {
          <div class="more">
            <button type="button" class="btn btn-outline" (click)="loadMore()" [disabled]="loading()">Tải thêm</button>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      .page { max-width: 760px; padding-top: 24px; padding-bottom: 48px; }
      .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
      h1 { font-size: 22px; margin: 0; }
      .tabs { display: flex; gap: 6px; margin-bottom: 14px; overflow-x: auto; }
      .tabs button { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 14px; font-weight: 600; color: var(--color-text-secondary); cursor: pointer; white-space: nowrap; }
      .tabs button.active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
      .count { opacity: 0.8; margin-left: 2px; }
      .muted { margin: 0; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
      .empty { text-align: center; padding: 36px 20px; }
      .empty p { margin: 0 0 14px; color: var(--color-text-muted); }
      .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      .item { display: block; color: var(--color-text); padding: 14px 16px; }
      .item:hover { border-color: var(--color-accent); color: var(--color-text); }
      .item.attention { border-color: #fcd34d; background: #fffbeb; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .subject { font-weight: 700; font-size: 15.5px; word-break: break-word; }
      .meta { font-size: 13px; color: var(--color-text-secondary); margin-top: 3px; }
      .preview { font-size: 14px; color: var(--color-text-secondary); margin-top: 6px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
      .who { font-weight: 600; }
      .time { font-size: 12.5px; color: var(--color-text-muted); margin-top: 6px; }
      .more { display: flex; justify-content: center; margin-top: 14px; }
    `,
  ],
})
export class TicketsPage implements OnInit {
  private readonly tickets = inject(TicketService);

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'Tất cả' },
    { key: 'open', label: 'Đang xử lý' },
    { key: 'done', label: 'Đã xong' },
  ];
  readonly tab = signal<Tab>('all');
  readonly items = signal<TicketListItem[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private page = 1;

  readonly visible = computed(() => {
    const tab = this.tab();
    return this.items().filter((t) => (tab === 'all' ? true : tab === 'open' ? isTicketOpen(t.status) : !isTicketOpen(t.status)));
  });

  category = ticketCategoryLabel;
  time = formatVnDateTime;

  ngOnInit(): void {
    void this.load(true);
  }

  countOf(tab: Tab): number {
    const list = this.items();
    return tab === 'all' ? list.length : list.filter((t) => (tab === 'open') === isTicketOpen(t.status)).length;
  }

  async load(reset: boolean): Promise<void> {
    if (reset) this.page = 1;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.tickets.list(this.page, PAGE_SIZE);
      this.items.set(reset ? res.items : [...this.items(), ...res.items]);
      this.total.set(res.total);
    } catch (e) {
      this.error.set(errorMessage(e, 'Không tải được danh sách yêu cầu'));
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    this.page += 1;
    await this.load(false);
  }
}
