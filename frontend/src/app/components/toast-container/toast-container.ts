import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

/** Vùng hiển thị toast, đặt một lần trong khung ứng dụng (app.html). */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  template: `
    <div class="toast-region" role="status" aria-live="polite">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast toast-' + toast.type">
          <span class="toast-message">{{ toast.message }}</span>
          <button type="button" class="toast-close" aria-label="Đóng thông báo" (click)="toastService.dismiss(toast.id)">
            ✕
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-region {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: min(380px, calc(100vw - 32px));
      }
      .toast {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-left-width: 4px;
        box-shadow: var(--shadow-md);
        font-size: 14px;
        color: var(--color-text);
      }
      .toast-success {
        border-left-color: var(--color-primary);
      }
      .toast-error {
        border-left-color: var(--color-error);
      }
      .toast-warning {
        border-left-color: var(--color-warning);
      }
      .toast-info {
        border-left-color: #3b82f6;
      }
      .toast-message {
        flex: 1;
        line-height: 1.4;
      }
      .toast-close {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        font-size: 14px;
        padding: 0 2px;
      }
      @media (max-width: 640px) {
        .toast-region {
          left: 12px;
          right: 12px;
          bottom: 12px;
          max-width: none;
        }
      }
    `,
  ],
})
export class ToastContainerComponent {
  readonly toastService = inject(ToastService);
}
