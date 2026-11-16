import { Component, computed, inject } from '@angular/core';
import { Location } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

/** 404: đường dẫn không tồn tại. Nút "Về trang chủ" đi đúng trang chủ của vai trò (hoặc /login nếu chưa đăng nhập). */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="container state-page">
      <div class="code">404</div>
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn bạn mở không tồn tại hoặc đã được chuyển đi.</p>
      <div class="actions">
        <a [routerLink]="homeLink()" class="btn btn-primary">{{ auth.isLoggedIn() ? 'Về trang chủ' : 'Đến trang đăng nhập' }}</a>
        <button type="button" class="btn btn-outline" (click)="back()">Quay lại</button>
      </div>
    </div>
  `,
  styles: [
    `
      .state-page { text-align: center; padding-top: 72px; padding-bottom: 48px; }
      .code { font-size: 64px; font-weight: 800; line-height: 1; color: var(--color-primary); }
      h1 { font-size: 22px; margin: 10px 0 8px; }
      p { color: var(--color-text-secondary); margin: 0 0 22px; }
      .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    `,
  ],
})
export class NotFound {
  readonly auth = inject(AuthService);
  private readonly location = inject(Location);

  readonly homeLink = computed(() => (this.auth.isLoggedIn() ? this.auth.homePath() : '/login'));

  back(): void {
    this.location.back();
  }
}
