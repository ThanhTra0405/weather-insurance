import { Component, OnDestroy, PLATFORM_ID, computed, inject, input, output, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ToastService } from '../../services/toast.service';

const HOLD_MS = 2000;

/**
 * Hộp hiển thị private key: ẩn mặc định, giữ nút 2 giây mới hiện, có Copy và Tải file backup.
 * Dùng ở bước sao lưu của /register và trang /wallet.
 */
@Component({
  selector: 'app-private-key-box',
  standalone: true,
  template: `
    <div class="key-box">
      <div class="key-label">Private key</div>
      <div class="key-value" [class.masked]="!revealed()" aria-live="polite">
        @if (revealed()) { {{ privateKey() }} } @else { •••••••••••••••••••••••••••••••••••••••••••••••• }
      </div>

      <div class="key-actions">
        @if (!revealed()) {
          <button type="button" class="btn btn-outline hold-btn"
            (pointerdown)="startHold($event)" (pointerup)="cancelHold()" (pointerleave)="cancelHold()"
            (pointercancel)="cancelHold()" (keydown.enter)="startHoldKey($event)" (keydown.space)="startHoldKey($event)"
            (keyup.enter)="cancelHold()" (keyup.space)="cancelHold()" (contextmenu)="$event.preventDefault()">
            <span class="hold-fill" [style.width.%]="progress()"></span>
            <span class="hold-text">Giữ để hiện (2 giây)</span>
          </button>
        } @else {
          <button type="button" class="btn btn-outline" (click)="revealed.set(false)">Ẩn key</button>
        }
        <button type="button" class="btn btn-outline" (click)="copy()">{{ copied() ? '✓ Đã copy' : 'Copy' }}</button>
        <button type="button" class="btn btn-primary" (click)="download()">⬇ Tải file backup</button>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .key-box { border: 1.5px dashed var(--color-warning); border-radius: var(--radius-md); padding: 14px; background: #fffbeb; }
      .key-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #92400e; margin-bottom: 6px; }
      .key-value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; word-break: break-all; color: var(--color-text); min-height: 40px; user-select: all; }
      .key-value.masked { user-select: none; letter-spacing: 1px; color: var(--color-text-secondary); }
      .key-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .key-actions .btn { padding: 8px 14px; font-size: 14px; }
      .hold-btn { position: relative; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; }
      .hold-fill { position: absolute; inset: 0 auto 0 0; background: var(--color-primary-light); transition: width 0.05s linear; z-index: 0; }
      .hold-text { position: relative; z-index: 1; }
    `,
  ],
})
export class PrivateKeyBoxComponent implements OnDestroy {
  readonly privateKey = input.required<string>();
  readonly address = input.required<string>();
  /** Phát ra khi người dùng đã bấm Copy (để cho phép "Tiếp tục"). */
  readonly keyCopied = output<void>();
  /** Phát ra khi người dùng đã tải file backup. */
  readonly keyDownloaded = output<void>();

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly toast = inject(ToastService);

  readonly revealed = signal(false);
  readonly copied = signal(false);
  private readonly heldMs = signal(0);
  readonly progress = computed(() => Math.min(100, (this.heldMs() / HOLD_MS) * 100));

  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  startHold(event: Event): void {
    event.preventDefault();
    this.beginHold();
  }

  startHoldKey(event: Event): void {
    event.preventDefault();
    if ((event as KeyboardEvent).repeat) return;
    this.beginHold();
  }

  private beginHold(): void {
    if (!this.isBrowser || this.timer) return;
    this.startedAt = Date.now();
    this.heldMs.set(0);
    this.timer = setInterval(() => {
      const held = Date.now() - this.startedAt;
      this.heldMs.set(held);
      if (held >= HOLD_MS) {
        this.stopTimer();
        this.revealed.set(true);
      }
    }, 50);
  }

  cancelHold(): void {
    this.stopTimer();
    this.heldMs.set(0);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.privateKey());
      this.copied.set(true);
      this.keyCopied.emit();
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.toast.error('Không copy được. Hãy bấm "Giữ để hiện" rồi chép tay, hoặc tải file backup.');
    }
  }

  download(): void {
    if (!this.isBrowser) return;
    const payload = {
      address: this.address(),
      privateKey: this.privateKey(),
      createdAt: new Date().toISOString(),
      note: 'Ví của hệ thống Bảo hiểm thời tiết (mạng thử nghiệm Sepolia). Ai giữ file này là giữ quyền với ví. Không chia sẻ cho ai.',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'weather-insurance-wallet.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.keyDownloaded.emit();
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }
}
