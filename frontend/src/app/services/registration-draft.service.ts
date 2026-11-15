import { Injectable } from '@angular/core';

/**
 * Chuyển ví từ trang /login sang /register khi gặp NOT_REGISTERED.
 * Chỉ nằm trong bộ nhớ (không ghi storage): tải lại trang thì mất và wizard bắt đầu từ bước 1.
 * source = 'recovered': người dùng vừa dán key/chọn file backup nên đã giữ key → bỏ qua bước sao lưu.
 * source = 'device': ví nằm sẵn trên máy, chưa rõ đã sao lưu chưa → vẫn qua bước sao lưu.
 */
export interface WalletDraft {
  address: string;
  privateKey: string;
  source: 'recovered' | 'device';
}

@Injectable({ providedIn: 'root' })
export class RegistrationDraftService {
  private draft: WalletDraft | null = null;

  set(draft: WalletDraft): void {
    this.draft = draft;
  }

  /** Lấy và xoá (dùng một lần). */
  take(): WalletDraft | null {
    const d = this.draft;
    this.draft = null;
    return d;
  }
}
