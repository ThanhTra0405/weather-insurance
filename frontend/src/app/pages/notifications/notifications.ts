import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NotificationDto } from '../../models/policy.models';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { ToastService } from '../../services/toast.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatVnDateTime } from '../../utils/format';
import { notificationIcon } from '../../utils/notification-icons';

const PAGE_SIZE = 20;

/** Trang /notifications (SPEC-B mục 9.3.6): danh sách phân trang, lọc chưa đọc, đọc tất cả. */
@Component({
  selector: 'app-notifications',
  standalone: true,
  template: `
    <div class="container page">
      <div class="head">
        <h1>Thông báo</h1>
        <div class="tools">
          <label class="check">
            <input type="checkbox" [checked]="unreadOnly()" (change)="toggleUnread($any($event.target).checked)" />
            <span>Chỉ chưa đọc</span>
          </label>
          <button type="button" class="btn btn-outline small" (click)="markAll()" [disabled]="unreadCount() === 0 || busy()">
            Đọc tất cả
          </button>
        </div>
      </div>

      @if (error(); as e) {
        <div class="alert alert-error" role="alert">
          {{ e }} <button type="button" class="link-btn" (click)="load()">Thử lại</button>
        </div>
      }

      @if (loading() && items().length === 0) {
        <div class="card"><p class="muted"><span class="spinner" aria-hidden="true"></span> Đang tải...</p></div>
      } @else if (items().length === 0 && !error()) {
        <div class="card"><p class="muted">{{ unreadOnly() ? 'Không có thông báo chưa đọc.' : 'Bạn chưa có thông báo nào.' }}</p></div>
      } @else {
        <ul class="list">
          @for (n of items(); track n.id) {
            <li>
              <button type="button" class="item card" [class.unread]="!n.isRead" (click)="openItem(n)">
                <span class="icon" aria-hidden="true">{{ icon(n.type) }}</span>
                <span class="text">
                  <span class="title">{{ n.title }} @if (!n.isRead) { <span class="dot" aria-label="chưa đọc"></span> }</span>
                  <span class="body">{{ n.body }}</span>
                  <span class="time">{{ time(n.createdAt) }}</span>
                </span>
              </button>
            </li>
          }
        </ul>

        @if (totalPages() > 1) {
          <div class="pager">
            <button type="button" class="btn btn-outline small" (click)="go(page() - 1)" [disabled]="page() <= 1 || loading()">← Trước</button>
            <span>Trang {{ page() }} / {{ totalPages() }}</span>
            <button type="button" class="btn btn-outline small" (click)="go(page() + 1)" [disabled]="page() >= totalPages() || loading()">Sau →</button>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      .page { max-width: 720px; padding-top: 24px; padding-bottom: 48px; }
      .head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
      h1 { font-size: 22px; margin: 0; }
      .tools { display: flex; align-items: center; gap: 14px; }
      .check { display: flex; align-items: center; gap: 6px; margin: 0; font-weight: 500; font-size: 14px; }
      .check input { width: auto; }
      .small { padding: 8px 14px; font-size: 14px; }
      .muted { margin: 0; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
      .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      .item { display: flex; gap: 12px; width: 100%; text-align: left; cursor: pointer; font-family: inherit; color: var(--color-text); padding: 12px 14px; }
      .item:hover { border-color: var(--color-accent); }
      .item.unread { background: #f0fdf4; border-color: #bbf7d0; }
      .icon { font-size: 22px; flex-shrink: 0; }
      .text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .title { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary); display: inline-block; }
      .body { font-size: 14px; color: var(--color-text-secondary); }
      .time { font-size: 12.5px; color: var(--color-text-muted); }
      .pager { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 16px; font-size: 14px; }
    `,
  ],
})
export class NotificationsPage implements OnInit {
  private readonly notifications = inject(NotificationsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly items = signal<NotificationDto[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly unreadOnly = signal(false);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly unreadCount = this.notifications.unread;
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  icon = notificationIcon;
  time = formatVnDateTime;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.notifications.list({ unreadOnly: this.unreadOnly(), page: this.page(), pageSize: PAGE_SIZE });
      this.items.set(res.items);
      this.total.set(res.total);
    } catch (e) {
      this.error.set(errorMessage(e, 'Không tải được thông báo'));
    } finally {
      this.loading.set(false);
    }
  }

  toggleUnread(checked: boolean): void {
    this.unreadOnly.set(checked);
    this.page.set(1);
    void this.load();
  }

  go(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.page.set(page);
    void this.load();
  }

  async openItem(n: NotificationDto): Promise<void> {
    try {
      await this.notifications.markRead(n);
    } catch {
      // vẫn cho chuyển trang
    }
    if (n.link) await this.router.navigateByUrl(this.auth.safeReturnUrl(n.link, '/notifications'));
  }

  async markAll(): Promise<void> {
    this.busy.set(true);
    try {
      await this.notifications.markAllRead();
      this.items.update((list) => list.map((n) => ({ ...n, isRead: true })));
      if (this.unreadOnly()) await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e, 'Không đánh dấu được đã đọc'));
    } finally {
      this.busy.set(false);
    }
  }
}
