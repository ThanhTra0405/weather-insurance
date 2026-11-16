import { Component, computed, inject } from '@angular/core';
import { Location } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

/** 403: đã đăng nhập nhưng không đủ quyền (ví dụ nông dân vào /admin, CSKH vào /admin/staff). */
@Component({
  selector: 'app-forbidden',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="container state-page" role="alert">
      <div class="code">403</div>
      <h1>Bạn không có quyền truy cập</h1>
      <p>
        @if (auth.isLoggedIn()) {
          Tài khoản <strong>{{ roleLabel() }}</strong> không được phép mở trang này.
        } @else {
          Vui lòng đăng nhập bằng tài khoản có quyền phù hợp.
        }
      </p>
      <div class="actions">
        <a [routerLink]="homeLink()" class="btn btn-primary">{{ auth.isLoggedIn() ? 'Về trang chính của tôi' : 'Đăng nhập' }}</a>
        <button type="button" class="btn btn-outline" (click)="back()">Quay lại</button>
      </div>
    </div>
  `,
  styles: [
    `
      .state-page { text-align: center; padding-top: 72px; padding-bottom: 48px; }
      .code { font-size: 64px; font-weight: 800; line-height: 1; color: var(--color-error); }
      h1 { font-size: 22px; margin: 10px 0 8px; }
      p { color: var(--color-text-secondary); margin: 0 0 22px; }
      .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    `,
  ],
})
export class Forbidden {
  readonly auth = inject(AuthService);
  private readonly location = inject(Location);

  readonly homeLink = computed(() => (this.auth.isLoggedIn() ? this.auth.homePath() : '/login'));
  readonly roleLabel = computed(() => {
    switch (this.auth.role()) {
      case 'admin':
        return 'Quản trị viên';
      case 'support':
        return 'CSKH';
      default:
        return 'Nông dân';
    }
  });

  back(): void {
    this.location.back();
  }
}
