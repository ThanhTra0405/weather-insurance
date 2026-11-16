import { Component, ElementRef, HostListener, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { NotificationDto } from '../../models/policy.models';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { formatVnDateTime } from '../../utils/format';
import { notificationIcon } from '../../utils/notification-icons';

const POLL_MS = 15_000;

/** Chuông thông báo ở thanh trên (chỉ nông dân): badge chưa đọc, polling 15 giây, dropdown 10 thông báo mới nhất. */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="bell-wrap">
      <button
        type="button"
        class="bell"
        aria-haspopup="true"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="unread() > 0 ? 'Thông báo, ' + unread() + ' chưa đọc' : 'Thông báo'"
        (click)="toggle($event)"
      >
        <span aria-hidden="true">🔔</span>
        @if (unread() > 0) { <span class="badge-count">{{ unread() > 99 ? '99+' : unread() }}</span> }
      </button>

      @if (open()) {
        <div class="panel" role="dialog" aria-label="Thông báo gần đây">
          <div class="panel-head">
            <strong>Thông báo</strong>
            <button type="button" class="link-btn" (click)="markAll()" [disabled]="unread() === 0">Đọc tất cả</button>
          </div>

          @if (loading()) {
            <p class="state"><span class="spinner" aria-hidden="true"></span> Đang tải...</p>
          } @else if (error(); as e) {
            <p class="state error">{{ e }}</p>
          } @else if (items().length === 0) {
            <p class="state">Chưa có thông báo nào.</p>
          } @else {
            <ul>
              @for (n of items(); track n.id) {
                <li>
                  <button type="button" class="item" [class.unread]="!n.isRead" (click)="openItem(n)">
                    <span class="icon" aria-hidden="true">{{ icon(n.type) }}</span>
                    <span class="text">
                      <span class="title">{{ n.title }}</span>
                      <span class="body">{{ n.body }}</span>
                      <span class="time">{{ time(n.createdAt) }}</span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          }

          <a class="all" routerLink="/notifications" (click)="open.set(false)">Xem tất cả</a>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .bell-wrap { position: relative; }
      .bell { position: relative; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center; }
      .bell:hover { background: var(--color-primary-light); }
      .badge-count { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--color-error); color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
      .panel { position: absolute; right: 0; top: calc(100% + 8px); width: 340px; max-width: calc(100vw - 24px); max-height: 70vh; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-md); z-index: 30; }
      .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--color-border); font-size: 14px; }
      .link-btn:disabled { opacity: 0.4; cursor: default; text-decoration: none; }
      ul { list-style: none; margin: 0; padding: 0; }
      .item { display: flex; gap: 10px; width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid var(--color-border); padding: 10px 14px; cursor: pointer; font-family: inherit; color: var(--color-text); }
      .item:hover { background: var(--color-bg-secondary); }
      .item.unread { background: #f0fdf4; }
      .icon { font-size: 18px; flex-shrink: 0; }
      .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .title { font-weight: 700; font-size: 13.5px; }
      .body { font-size: 13px; color: var(--color-text-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .time { font-size: 12px; color: var(--color-text-muted); }
      .state { margin: 0; padding: 16px 14px; font-size: 14px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
      .state.error { color: var(--color-error); }
      .all { display: block; text-align: center; padding: 10px; font-size: 14px; font-weight: 600; }
    `,
  ],
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private readonly notifications = inject(NotificationsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly unread = this.notifications.unread;
  readonly open = signal(false);
  readonly items = signal<NotificationDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;

  icon = notificationIcon;
  time = formatVnDateTime;

  ngOnInit(): void {
    if (!this.isBrowser) return;
    void this.notifications.refreshUnread();
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.notifications.refreshUnread();
    }, POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.notifications.reset();
  }

  async toggle(event: Event): Promise<void> {
    event.stopPropagation();
    this.open.update((v) => !v);
    if (this.open()) await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.notifications.list({ pageSize: 10 });
      this.items.set(page.items);
    } catch {
      this.error.set('Không tải được thông báo');
    } finally {
      this.loading.set(false);
    }
  }

  async openItem(n: NotificationDto): Promise<void> {
    try {
      await this.notifications.markRead(n);
    } catch {
      // vẫn cho chuyển trang dù đánh dấu đã đọc lỗi
    }
    this.open.set(false);
    if (n.link) await this.router.navigateByUrl(this.auth.safeReturnUrl(n.link, '/notifications'));
  }

  async markAll(): Promise<void> {
    try {
      await this.notifications.markAllRead();
      this.items.update((list) => list.map((n) => ({ ...n, isRead: true })));
    } catch {
      this.error.set('Không đánh dấu được đã đọc');
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
