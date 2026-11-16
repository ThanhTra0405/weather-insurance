import { Component, ViewEncapsulation } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface AdminNavItem {
  label: string;
  path: string;
}

/**
 * Khung quản trị (/admin, chỉ admin): thanh bên trên desktop, thanh cuộn ngang trên điện thoại.
 * Nhóm "Nghiệp vụ" là trang của B; nhóm "Blockchain" là trang của A (route con gắn ở app.routes.ts).
 * ViewEncapsulation.None + ac-shared.css: các trang của A dùng class .ac-* mà trước đây do AdminChainShell nạp.
 */
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../admin-chain/ac-shared.css', './admin-shell.css'],
  template: `
    <div class="admin-shell">
      <aside class="admin-side" aria-label="Quản trị">
        <div class="side-group">
          <div class="side-title">Nghiệp vụ</div>
          <nav class="side-nav">
            @for (item of business; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active">{{ item.label }}</a>
            }
          </nav>
        </div>
        <div class="side-group">
          <div class="side-title">Blockchain</div>
          <nav class="side-nav">
            @for (item of chain; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active">{{ item.label }}</a>
            }
          </nav>
        </div>
      </aside>
      <section class="admin-content">
        <router-outlet />
      </section>
    </div>
  `,
})
export class AdminShell {
  readonly business: AdminNavItem[] = [
    { label: 'Duyệt hồ sơ', path: '/admin/review' },
    { label: 'Nhân viên', path: '/admin/staff' },
    { label: 'Nhật ký', path: '/admin/audit' },
  ];

  readonly chain: AdminNavItem[] = [
    { label: 'Tổng quan', path: '/admin/dashboard' },
    { label: 'Sản phẩm', path: '/admin/products' },
    { label: 'Hệ thống', path: '/admin/system' },
    { label: 'Oracle', path: '/admin/oracle' },
    { label: 'Bồi thường', path: '/admin/payouts' },
  ];
}
