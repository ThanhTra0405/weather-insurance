import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forbidden',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="container state-page">
      <h1>403</h1>
      <p>Bạn không có quyền truy cập trang này.</p>
      <a routerLink="/" class="btn btn-primary">Về trang chủ</a>
    </div>
  `,
  styles: [
    `
      .state-page {
        text-align: center;
        padding-top: 72px;
      }
      h1 {
        font-size: 48px;
        margin: 0 0 8px;
        color: var(--color-error);
      }
      p {
        color: var(--color-text-secondary);
        margin: 0 0 20px;
      }
    `,
  ],
})
export class Forbidden {}
