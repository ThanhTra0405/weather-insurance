import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from './services/auth.service';
import { AccountMenuComponent } from './components/account-menu/account-menu';
import { ToastContainerComponent } from './components/toast-container/toast-container';

interface NavItem {
  label: string;
  path: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AccountMenuComponent, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Inject ở đây để AuthService khởi tạo ngay lúc mở ứng dụng và khôi phục phiên đăng nhập.
  readonly auth = inject(AuthService);

  readonly homeLink = computed(() => (this.auth.isLoggedIn() ? this.auth.homePath() : '/login'));

  /**
   * Thanh điều hướng theo vai trò. Chưa đăng nhập: không có mục nào (chỉ logo + Đăng nhập/Đăng ký).
   * Các mục Hỗ trợ, Góp vốn (LP), Ví sẽ thêm khi trang tương ứng có (ngày 2–3).
   */
  readonly navItems = computed<NavItem[]>(() => {
    switch (this.auth.role()) {
      case 'farmer':
        return [
          { label: 'Tổng quan', path: '/dashboard' },
          { label: 'Mua bảo hiểm', path: '/buy-policy' },
          { label: 'Góp vốn', path: '/lp' },
          { label: 'Hồ sơ', path: '/profile' },
        ];
      case 'admin':
        return [
          { label: 'Hỗ trợ', path: '/support' },
          { label: 'Quản trị', path: '/admin/dashboard' },
        ];
      case 'support':
        return [{ label: 'Hỗ trợ', path: '/support' }];
      default:
        return [];
    }
  });
}
