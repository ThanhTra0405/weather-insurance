import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

/** Đăng nhập nhân viên (admin, CSKH) bằng email + mật khẩu (SPEC-B mục 9.2). */
@Component({
  selector: 'app-staff-login',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="auth-logo">🛠️</div>
        <h1 class="auth-title">Đăng nhập nhân viên</h1>
        <p class="auth-sub">Dành cho quản trị viên và CSKH</p>

        @if (errorMsg(); as msg) { <div class="alert alert-error" role="alert">{{ msg }}</div> }

        <form (submit)="onSubmit($event)" novalidate>
          <div class="field">
            <label for="staff-email">Email</label>
            <input id="staff-email" type="email" autocomplete="username" [value]="email()" [disabled]="busy()"
              (input)="email.set($any($event.target).value)" />
          </div>
          <div class="field">
            <label for="staff-password">Mật khẩu</label>
            <div class="input-with-btn">
              <input id="staff-password" [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password"
                [value]="password()" [disabled]="busy()" (input)="password.set($any($event.target).value)" />
              <button type="button" class="btn btn-outline small" (click)="showPassword.set(!showPassword())"
                [attr.aria-pressed]="showPassword()">{{ showPassword() ? 'Ẩn' : 'Hiện' }}</button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-block" [disabled]="busy()">
            @if (busy()) { <span class="spinner" aria-hidden="true"></span> Đang đăng nhập... }
            @else { Đăng nhập }
          </button>
        </form>

        <p class="help">Tài khoản nhân viên do quản trị viên cấp. Quên mật khẩu: liên hệ quản trị viên.</p>
        <p class="help">Bạn là nông dân? <a routerLink="/login">Đăng nhập tại đây</a></p>
      </div>
    </div>
  `,
  styles: [
    `
      .input-with-btn { display: flex; gap: 8px; }
      .input-with-btn .small { padding: 8px 12px; font-size: 13px; flex-shrink: 0; }
    `,
  ],
})
export class StaffLogin implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly email = signal('');
  readonly password = signal('');
  readonly showPassword = signal(false);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  private returnUrl: string | null = null;

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  private async submit(): Promise<void> {
    if (this.busy()) return;
    const email = this.email().trim();
    if (!email || !this.password()) {
      this.errorMsg.set('Vui lòng nhập email và mật khẩu');
      return;
    }

    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      await this.auth.loginStaff(email, this.password());
      this.password.set('');
      await this.router.navigateByUrl(this.auth.safeReturnUrl(this.returnUrl));
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 429) this.errorMsg.set('Đăng nhập sai quá nhiều lần, thử lại sau 15 phút');
        else if (e.status === 401) this.errorMsg.set('Sai email hoặc mật khẩu');
        else if (e.status === 0 || e.status >= 500) this.errorMsg.set('Không kết nối được máy chủ');
        else this.errorMsg.set(e.message);
      } else {
        this.errorMsg.set('Đăng nhập thất bại');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
