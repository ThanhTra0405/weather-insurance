import { Injectable, inject, signal } from '@angular/core';
import { NotificationDto, NotificationPage } from '../models/policy.models';
import { ApiService } from './api.service';

/** Thông báo trong ứng dụng của nông dân (SPEC-B mục 7.2, 9.3.6). */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);

  /** Số chưa đọc, dùng cho badge ở chuông. */
  readonly unread = signal(0);

  async refreshUnread(): Promise<void> {
    try {
      const res = await this.api.get<{ unread: number }>('/api/notifications/unread-count');
      this.unread.set(Number(res.unread) || 0);
    } catch {
      // lỗi mạng khi polling: giữ giá trị cũ
    }
  }

  async list(options: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}): Promise<NotificationPage> {
    const res = await this.api.get<NotificationPage>('/api/notifications', {
      unreadOnly: options.unreadOnly ?? false,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 20,
    });
    this.unread.set(Number(res.unread) || 0);
    return res;
  }

  async markRead(item: NotificationDto): Promise<void> {
    if (item.isRead) return;
    await this.api.post(`/api/notifications/${item.id}/read`);
    item.isRead = true;
    this.unread.update((n) => Math.max(0, n - 1));
  }

  async markAllRead(): Promise<void> {
    await this.api.post('/api/notifications/read-all');
    this.unread.set(0);
  }

  reset(): void {
    this.unread.set(0);
  }
}
