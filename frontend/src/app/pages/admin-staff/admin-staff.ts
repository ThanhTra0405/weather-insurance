import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { PageStateComponent } from '../../components/page-state/page-state';
import { StaffAccount } from '../../models/ticket.models';
import { AdminStaffService } from '../../services/admin-staff.service';
import { ApiError } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatVnDate } from '../../utils/format';

type DialogKind = 'create' | 'role' | 'password' | 'toggle';
const MIN_PASSWORD = 10;

interface DialogState {
  kind: DialogKind;
  target: StaffAccount | null;
}

const ROLE_LABELS: Record<string, string> = { admin: 'Quản trị viên', support: 'CSKH' };

/** /admin/staff: danh sách nhân viên, tạo mới, khoá/mở, đổi vai trò, đặt lại mật khẩu (SPEC-B mục 8 và 9.4.8). */
@Component({
  selector: 'app-admin-staff',
  standalone: true,
  imports: [PageStateComponent, NgTemplateOutlet],
  template: `
    <div class="container page">
      <div class="page-head">
        <div>
          <h1>Nhân viên</h1>
          <p class="page-sub">Tài khoản admin và CSKH. Nhân viên không tự đăng ký; quên mật khẩu thì đặt lại tại đây.</p>
        </div>
        <button type="button" class="btn btn-primary" (click)="open('create', null)">+ Tạo nhân viên</button>
      </div>

      <app-page-state [loading]="loading() && items().length === 0" [error]="error()"
        [empty]="!loading() && !error() && items().length === 0" emptyText="Chưa có nhân viên nào." (retry)="load()" />

      @if (items().length > 0) {
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr>
            </thead>
            <tbody>
              @for (s of items(); track s.id) {
                <tr [class.inactive]="!s.active">
                  <td class="strong">{{ s.fullName }}@if (s.isSelf) { <span class="self">Bạn</span> }</td>
                  <td class="break">{{ s.email }}</td>
                  <td>{{ roleLabel(s.role) }}</td>
                  <td>
                    <span class="badge" [class.badge-active]="s.active" [class.badge-closed]="!s.active">{{ s.active ? 'Hoạt động' : 'Đã khoá' }}</span>
                  </td>
                  <td class="nowrap">{{ date(s.createdAt) }}</td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-outline btn-sm" [disabled]="s.isSelf" [title]="s.isSelf ? 'Không thể tự đổi vai trò của chính mình' : ''"
                        (click)="open('role', s)">Đổi vai trò</button>
                      <button type="button" class="btn btn-outline btn-sm" (click)="open('password', s)">Đặt lại mật khẩu</button>
                      <button type="button" class="btn btn-sm" [class.btn-outline]="!s.active" [class.btn-danger]="s.active" [disabled]="s.isSelf"
                        [title]="s.isSelf ? 'Không thể tự khoá tài khoản của chính mình' : ''" (click)="open('toggle', s)">
                        {{ s.active ? 'Khoá' : 'Mở khoá' }}
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (dialog(); as d) {
      <div class="overlay" (click)="close()">
        <form class="dialog card" role="dialog" aria-modal="true" aria-labelledby="sd-title" (click)="$event.stopPropagation()" (submit)="onSubmit($event)">
          @switch (d.kind) {
            @case ('create') {
              <h2 id="sd-title">Tạo nhân viên</h2>
              <div class="field">
                <label for="sd-email">Email</label>
                <input id="sd-email" type="email" autocomplete="off" [value]="email()" [disabled]="busy()" [attr.aria-invalid]="!!fieldErrors()['email']"
                  (input)="email.set($any($event.target).value)" />
                @if (fieldErrors()['email']; as e) { <p class="field-error">{{ e }}</p> }
              </div>
              <div class="field">
                <label for="sd-name">Họ tên</label>
                <input id="sd-name" type="text" maxlength="100" [value]="fullName()" [disabled]="busy()" [attr.aria-invalid]="!!fieldErrors()['fullName']"
                  (input)="fullName.set($any($event.target).value)" />
                @if (fieldErrors()['fullName']; as e) { <p class="field-error">{{ e }}</p> }
              </div>
              <div class="field">
                <label for="sd-role">Vai trò</label>
                <select id="sd-role" [disabled]="busy()" (change)="role.set($any($event.target).value)">
                  <option value="support" [selected]="role() === 'support'">CSKH (support)</option>
                  <option value="admin" [selected]="role() === 'admin'">Quản trị viên (admin)</option>
                </select>
                @if (fieldErrors()['role']; as e) { <p class="field-error">{{ e }}</p> }
              </div>
              <ng-container *ngTemplateOutlet="pwField" />
            }
            @case ('role') {
              <h2 id="sd-title">Đổi vai trò</h2>
              <p class="dlg-text">Nhân viên: <strong>{{ d.target?.fullName }}</strong> ({{ d.target?.email }})</p>
              <div class="field">
                <label for="sd-role2">Vai trò mới</label>
                <select id="sd-role2" [disabled]="busy()" (change)="role.set($any($event.target).value)">
                  <option value="support" [selected]="role() === 'support'">CSKH (support)</option>
                  <option value="admin" [selected]="role() === 'admin'">Quản trị viên (admin)</option>
                </select>
              </div>
            }
            @case ('password') {
              <h2 id="sd-title">Đặt lại mật khẩu</h2>
              <p class="dlg-text">Đặt mật khẩu mới cho <strong>{{ d.target?.fullName }}</strong>. Hãy gửi mật khẩu này cho họ qua kênh riêng.</p>
              <ng-container *ngTemplateOutlet="pwField" />
            }
            @case ('toggle') {
              <h2 id="sd-title">{{ d.target?.active ? 'Khoá tài khoản' : 'Mở khoá tài khoản' }}</h2>
              <p class="dlg-text">
                @if (d.target?.active) {
                  <strong>{{ d.target?.fullName }}</strong> sẽ không đăng nhập được nữa cho tới khi được mở khoá.
                } @else {
                  <strong>{{ d.target?.fullName }}</strong> sẽ đăng nhập lại được.
                }
              </p>
            }
          }

          @if (formError(); as fe) { <div class="alert alert-error" role="alert">{{ fe }}</div> }
          <div class="dialog-actions">
            <button type="button" class="btn btn-outline" (click)="close()" [disabled]="busy()">Huỷ</button>
            <button type="submit" class="btn" [class.btn-danger]="d.kind === 'toggle' && d.target?.active" [class.btn-primary]="!(d.kind === 'toggle' && d.target?.active)" [disabled]="busy()">
              @if (busy()) { <span class="spinner" aria-hidden="true"></span> Đang xử lý... } @else { {{ submitLabel(d) }} }
            </button>
          </div>
        </form>
      </div>
    }

    <ng-template #pwField>
      <div class="field">
        <label for="sd-pw">Mật khẩu (từ {{ minPw }} ký tự)</label>
        <div class="pw-row">
          <input id="sd-pw" [type]="showPw() ? 'text' : 'password'" autocomplete="new-password" [value]="password()" [disabled]="busy()"
            [attr.aria-invalid]="!!fieldErrors()['password']" (input)="password.set($any($event.target).value)" />
          <button type="button" class="btn btn-outline btn-sm" (click)="showPw.set(!showPw())">{{ showPw() ? 'Ẩn' : 'Hiện' }}</button>
        </div>
        @if (password().length > 0 && password().length < minPw) { <p class="field-error">Cần ít nhất {{ minPw }} ký tự</p> }
        @else if (fieldErrors()['password']; as e) { <p class="field-error">{{ e }}</p> }
      </div>
    </ng-template>
  `,
  styles: [
    `
      .page { padding-top: 24px; padding-bottom: 48px; }
      .strong { font-weight: 600; }
      .break { word-break: break-all; }
      .nowrap { white-space: nowrap; }
      .inactive td { color: var(--color-text-muted); }
      .self { margin-left: 6px; font-size: 11px; background: var(--color-primary-light); color: var(--color-primary-dark); border-radius: 999px; padding: 1px 8px; font-weight: 700; }
      .actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .dlg-text { font-size: 14px; color: var(--color-text-secondary); margin: 0 0 12px; }
      .pw-row { display: flex; gap: 8px; }
    `,
  ],
})
export class AdminStaffPage implements OnInit {
  private readonly svc = inject(AdminStaffService);
  private readonly toast = inject(ToastService);

  readonly minPw = MIN_PASSWORD;
  readonly items = signal<StaffAccount[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly dialog = signal<DialogState | null>(null);
  readonly busy = signal(false);
  readonly formError = signal<string | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});

  readonly email = signal('');
  readonly fullName = signal('');
  readonly role = signal('support');
  readonly password = signal('');
  readonly showPw = signal(false);

  date = formatVnDate;
  roleLabel = (r: string): string => ROLE_LABELS[r] ?? r;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.svc.list());
    } catch (e) {
      this.error.set(errorMessage(e, 'Không tải được danh sách nhân viên'));
    } finally {
      this.loading.set(false);
    }
  }

  open(kind: DialogKind, target: StaffAccount | null): void {
    this.formError.set(null);
    this.fieldErrors.set({});
    this.email.set('');
    this.fullName.set('');
    this.password.set('');
    this.showPw.set(false);
    this.role.set(kind === 'role' && target ? target.role : 'support');
    this.dialog.set({ kind, target });
  }

  close(): void {
    if (!this.busy()) this.dialog.set(null);
  }

  submitLabel(d: DialogState): string {
    switch (d.kind) {
      case 'create':
        return 'Tạo tài khoản';
      case 'role':
        return 'Lưu vai trò';
      case 'password':
        return 'Đặt mật khẩu';
      default:
        return d.target?.active ? 'Khoá tài khoản' : 'Mở khoá';
    }
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const d = this.dialog();
    if (!d || this.busy()) return;

    // Kiểm tra sơ bộ phía client; server kiểm lại toàn bộ.
    const errors: Record<string, string> = {};
    if (d.kind === 'create') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email().trim())) errors['email'] = 'Email không hợp lệ';
      const name = this.fullName().trim();
      if (name.length < 2 || name.length > 100) errors['fullName'] = 'Họ tên phải từ 2 đến 100 ký tự';
    }
    if ((d.kind === 'create' || d.kind === 'password') && this.password().length < MIN_PASSWORD) {
      errors['password'] = `Mật khẩu phải có ít nhất ${MIN_PASSWORD} ký tự`;
    }
    this.fieldErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.busy.set(true);
    this.formError.set(null);
    try {
      let message: string;
      switch (d.kind) {
        case 'create':
          await this.svc.create({ email: this.email().trim(), fullName: this.fullName().trim(), role: this.role(), password: this.password() });
          message = 'Đã tạo tài khoản nhân viên';
          break;
        case 'role':
          if (this.role() === d.target!.role) {
            this.dialog.set(null);
            return;
          }
          await this.svc.update(d.target!.id, { role: this.role() });
          message = 'Đã đổi vai trò';
          break;
        case 'password':
          await this.svc.update(d.target!.id, { password: this.password() });
          message = 'Đã đặt lại mật khẩu';
          break;
        default:
          await this.svc.update(d.target!.id, { active: !d.target!.active });
          message = d.target!.active ? 'Đã khoá tài khoản' : 'Đã mở khoá tài khoản';
      }
      this.toast.success(message);
      this.dialog.set(null);
      await this.load();
    } catch (e) {
      // Các quy tắc ở SPEC mục 8 (LAST_ADMIN, SELF_*, EMAIL_EXISTS) trả message tiếng Việt từ server.
      if (e instanceof ApiError && e.fields) this.fieldErrors.set(e.fields);
      this.formError.set(errorMessage(e, 'Không thực hiện được, vui lòng thử lại'));
    } finally {
      this.busy.set(false);
    }
  }
}
