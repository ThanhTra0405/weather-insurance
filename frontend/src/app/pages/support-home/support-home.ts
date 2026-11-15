import { Component } from '@angular/core';

/** Tạm thời: hàng đợi CSKH sẽ viết ở ngày 3. Có trang này để đăng nhập support không rơi vào 404. */
@Component({
  selector: 'app-support-home',
  standalone: true,
  template: `
    <div class="container page">
      <h1>Hỗ trợ khách hàng</h1>
      <div class="card"><p>Hàng đợi ticket đang được xây dựng (ngày 3).</p></div>
    </div>
  `,
  styles: [`.page { padding-top: 24px; } h1 { font-size: 24px; margin: 0 0 16px; } p { margin: 0; color: var(--color-text-secondary); }`],
})
export class SupportHome {}
