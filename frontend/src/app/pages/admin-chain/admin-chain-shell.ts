import { Component, ViewEncapsulation } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Khung điều hướng cho các trang quản trị blockchain. Style dùng chung nằm ở ac-shared.css. */
@Component({
  selector: 'app-admin-chain-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac-shared.css',
  template: `
    <div class="ac-wrap">
      <nav class="ac-nav" aria-label="Quản trị">
        <a routerLink="/admin/dashboard" routerLinkActive="active">Tổng quan</a>
        <a routerLink="/admin/review" routerLinkActive="active">Duyệt hồ sơ</a>
        <a routerLink="/admin/products" routerLinkActive="active">Sản phẩm</a>
        <a routerLink="/admin/system" routerLinkActive="active">Hệ thống</a>
        <a routerLink="/admin/oracle" routerLinkActive="active">Oracle</a>
        <a routerLink="/admin/payouts" routerLinkActive="active">Bồi thường</a>
      </nav>
      <router-outlet />
    </div>
  `,
})
export class AdminChainShell {}
