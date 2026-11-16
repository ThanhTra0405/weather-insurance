import { Component, input, output } from '@angular/core';

/**
 * Trạng thái dùng chung cho danh sách/trang: đang tải, lỗi (có nút Thử lại), rỗng.
 * Nội dung chính đặt ngoài component này, chỉ hiện khi không ở các trạng thái trên.
 */
@Component({
  selector: 'app-page-state',
  standalone: true,
  template: `
    @if (loading()) {
      <div class="card state-box" role="status"><span class="spinner" aria-hidden="true"></span> Đang tải...</div>
    } @else if (error(); as e) {
      <div class="card state-box" role="alert">
        <div class="alert alert-error">{{ e }}</div>
        <button type="button" class="btn btn-outline" (click)="retry.emit()">Thử lại</button>
      </div>
    } @else if (empty()) {
      <div class="card state-box"><p>{{ emptyText() }}</p><ng-content /></div>
    }
  `,
})
export class PageStateComponent {
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly empty = input(false);
  readonly emptyText = input('Không có dữ liệu.');
  readonly retry = output<void>();
}
