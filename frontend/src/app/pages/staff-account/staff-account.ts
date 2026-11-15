import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiError, ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

interface MeResponse {
  role: string;
  fullName?: string;
  email?: string;
}

/** Tài khoản nhân viên: xem thông tin, đổi mật khẩu, đăng xuất (SPEC-B mục 9.2). */
@Component({
  selector: 'app-staff-account',
  standalone: true,
  template: `
    <div class="container page">
      <h1>Tài khoản</h1>

      <div class="card block">
        <dl class="info">
          <dt>Họ tên</dt><dd>{{ auth.fullName() ?? '...' }}</dd>
          <dt>Email</dt><dd>{{ email() ?? '...' }}</dd>
          <dt>Vai trò</dt><dd>{{ roleLabel() }}</dd>
        </dl>
      </div>

      <div class="card block">
        <h2>Đổi mật khẩu</h2>
        @if (errorMsg(); as msg) { <div class="alert alert-error" role="alert">{{ msg }}</div> }
        <form (submit)="onSubmit($event)" novalidate>
          <div class="field">
            <label for="cp-current">Mật khẩu hiện tại</label>
            <input id="cp-current" type="password" autocomplete="current-password" [value]="current()" [disabled]="busy()"
              (input)="current.set($any($event.target).value)" />
          </div>
          <div class="field">
            <label for="cp-new">Mật khẩu mới (từ 10 ký tự)</label>
            <input id="cp-new" type="password" autocomplete="new-password" [value]="next()" [disabled]="busy()"
              (input)="next.set($any($event.target).value)" />
            @if (next().length > 0 && next().length < 10) { <p class="field-error">Cần ít nhất 10 ký tự</p> }
            @else if (next() && next() === current()) { <p class="field-error">Mật khẩu mới phải khác mật khẩu cũ</p> }
          </div>
          <div class="field">
            <label for="cp-confirm">Nhập lại mật khẩu mới</label>
            <input id="cp-confirm" type="password" autocomplete="new-password" [value]="confirm()" [disabled]="busy()"
              (input)="confirm.set($any($event.target).value)" />
            @if (confirm() && confirm() !== next()) { <p class="field-error">Mật khẩu nhập lại chưa khớp</p> }
          </div>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !canSubmit()">
            @if (busy()) { <span class="spinner" aria-hidden="true"></span> Đang lưu... } @else { Đổi mật khẩu }
          </button>
        </form>
      </div>

      <button type="button" class="btn btn-outline" (click)="auth.logout()">Đăng xuất</button>
    </div>
  `,
  styles: [
    `
      .page { max-width: 560px; padding-top: 24px; padding-bottom: 40px; }
      h1 { font-size: 24px; margin: 0 0 16px; }
      h2 { font-size: 17px; margin: 0 0 12px; }
      .block { margin-bottom: 16px; }
      .info { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0; font-size: 15px; }
      .info dt { color: var(--color-text-secondary); font-weight: 600; }
      .info dd { margin: 0; word-break: break-word; }
    `,
  ],
})
export class StaffAccount implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly email = signal<string | null>(null);
  readonly current = signal('');
  readonly next = signal('');
  readonly confirm = signal('');
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  readonly roleLabel = computed(() => (this.auth.role() === 'admin' ? 'Quản trị viên' : 'CSKH'));
  readonly canSubmit = computed(
    () =>
      this.current().length > 0 &&
      this.next().length >= 10 &&
      this.next() !== this.current() &&
      this.next() === this.confirm(),
  );

  async ngOnInit(): Promise<void> {
    try {
      const me = await this.api.get<MeResponse>('/api/auth/me');
      this.email.set(me.email ?? '—');
      if (me.fullName) this.auth.fullName.set(me.fullName);
    } catch {
      this.email.set('—');
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  private async submit(): Promise<void> {
    if (this.busy() || !this.canSubmit()) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      await this.auth.changeStaffPassword(this.current(), this.next());
      this.current.set('');
      this.next.set('');
      this.confirm.set('');
      this.toast.success('Đã đổi mật khẩu');
    } catch (e) {
      this.errorMsg.set(e instanceof ApiError ? e.message : 'Không đổi được mật khẩu');
    } finally {
      this.busy.set(false);
    }
  }
}
