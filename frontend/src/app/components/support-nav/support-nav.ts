import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Thanh điều hướng con của khu CSKH: Hàng đợi · Tra cứu · Mẫu trả lời (admin và support). */
@Component({
  selector: 'app-support-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="pill-tabs support-nav" aria-label="Khu vực hỗ trợ">
      <a routerLink="/support" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="active">Hàng đợi</a>
      <a routerLink="/support/lookup" routerLinkActive="active">Tra cứu nông dân</a>
      <a routerLink="/support/canned" routerLinkActive="active">Mẫu trả lời</a>
    </nav>
  `,
  styles: [
    `
      .support-nav a {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        padding: 7px 14px;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-secondary);
        white-space: nowrap;
      }
      .support-nav a.active {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: #fff;
      }
    `,
  ],
})
export class SupportNavComponent {}
