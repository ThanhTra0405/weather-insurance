import { Component, inject, input, signal } from '@angular/core';
import { EvidenceKind, EvidenceMetaDto } from '../../models/policy.models';
import { PolicyService } from '../../services/policy.service';
import { errorMessage, isForbidden } from '../../utils/api-helpers';
import { formatVnDateTime, shortHash } from '../../utils/format';

const EXIF_WARNING_METERS = 300; // cùng ngưỡng với trang duyệt hồ sơ và backend (SupportController)
const LABELS: Record<EvidenceKind, string> = { selfie: 'Chân dung', field: 'Ruộng', document: 'Giấy tờ đất' };

/**
 * Xem hồ sơ xác minh CHỈ ĐỌC cho CSKH (SPEC-B mục 6.3 và 9.4.3): meta, cờ EXIF, ảnh qua signed URL (hết hạn sau 5 phút).
 * Không có nút duyệt/từ chối: việc duyệt chỉ ở /admin/review.
 */
@Component({
  selector: 'app-evidence-viewer',
  standalone: true,
  template: `
    @if (!opened()) {
      <button type="button" class="btn btn-outline btn-sm" (click)="open()">Xem hồ sơ xác minh</button>
    } @else if (loading()) {
      <p class="muted"><span class="spinner" aria-hidden="true"></span> Đang tải hồ sơ...</p>
    } @else if (error(); as e) {
      <div class="alert alert-error" role="alert">{{ e }}</div>
      <button type="button" class="btn btn-outline btn-sm" (click)="open()">Thử lại</button>
    } @else if (meta(); as m) {
      <ul class="checks">
        <li [class.ok]="m.exifGpsPresent" [class.warn]="!m.exifGpsPresent">
          {{ m.exifGpsPresent ? 'Ảnh ruộng có toạ độ GPS (EXIF)' : 'Ảnh ruộng không có GPS (EXIF)' }}
        </li>
        @if (m.distanceMeters !== null) {
          <li [class.ok]="m.distanceMeters <= warnM" [class.warn]="m.distanceMeters > warnM">
            Lệch {{ m.distanceMeters.toFixed(0) }} m so với vị trí khai báo
          </li>
        }
        <li class="plain">Gửi lúc {{ time(m.uploadedAt) }}@if (m.locked) { · đã khoá (hash đã lên blockchain) }</li>
      </ul>
      <div class="photos">
        @for (k of kinds; track k) {
          <figure>
            @if (images()[k] && !failed()[k]) {
              <a [href]="images()[k]!" target="_blank" rel="noopener noreferrer">
                <img [src]="images()[k]!" [alt]="labels[k]" loading="lazy" (error)="markFailed(k)" />
              </a>
            } @else {
              <div class="fallback">Không tải được ảnh</div>
            }
            <figcaption>{{ labels[k] }}</figcaption>
          </figure>
        }
      </div>
      <p class="hash">Hash ảnh ruộng: <span class="mono">{{ short(m.fieldPhotoHash) }}</span></p>
    } @else {
      <p class="muted">Nông dân chưa gửi hồ sơ cho policy này.</p>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .muted { margin: 0 0 8px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
      .checks { list-style: none; padding: 0; margin: 0 0 10px; display: grid; gap: 4px; font-size: 13.5px; }
      .checks li::before { content: '•'; display: inline-block; width: 16px; color: var(--color-text-muted); }
      .checks li.ok { color: var(--color-primary-dark); }
      .checks li.ok::before { content: '✓'; color: var(--color-primary); font-weight: 700; }
      .checks li.warn { color: #92400e; font-weight: 600; }
      .checks li.warn::before { content: '!'; color: var(--color-warning); font-weight: 700; }
      .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      figure { margin: 0; }
      img { width: 100%; height: 100px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--color-border); display: block; }
      figcaption { font-size: 12px; text-align: center; color: var(--color-text-secondary); margin-top: 3px; }
      .fallback { height: 100px; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; color: var(--color-text-muted); background: var(--color-bg-secondary); border: 1px dashed var(--color-border); border-radius: var(--radius-sm); padding: 4px; }
      .hash { font-size: 12.5px; color: var(--color-text-secondary); margin: 8px 0 0; word-break: break-all; }
    `,
  ],
})
export class EvidenceViewerComponent {
  private readonly policies = inject(PolicyService);

  readonly policyId = input.required<number>();

  readonly kinds: EvidenceKind[] = ['selfie', 'field', 'document'];
  readonly labels = LABELS;
  readonly warnM = EXIF_WARNING_METERS;

  readonly opened = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly meta = signal<EvidenceMetaDto | null>(null);
  readonly images = signal<Record<EvidenceKind, string | null>>({ selfie: null, field: null, document: null });
  readonly failed = signal<Record<EvidenceKind, boolean>>({ selfie: false, field: false, document: false });

  time = formatVnDateTime;
  short = shortHash;

  async open(): Promise<void> {
    this.opened.set(true);
    this.loading.set(true);
    this.error.set(null);
    this.failed.set({ selfie: false, field: false, document: false });
    try {
      const id = this.policyId();
      const meta = await this.policies.evidenceMeta(id);
      this.meta.set(meta);
      if (meta) {
        const next: Record<EvidenceKind, string | null> = { selfie: null, field: null, document: null };
        await Promise.all(
          this.kinds.map(async (k) => {
            try {
              next[k] = await this.policies.evidenceImageUrl(id, k);
            } catch {
              next[k] = null;
            }
          }),
        );
        this.images.set(next);
      }
    } catch (e) {
      this.error.set(isForbidden(e) ? 'Bạn không có quyền xem hồ sơ này' : errorMessage(e, 'Không tải được hồ sơ'));
    } finally {
      this.loading.set(false);
    }
  }

  markFailed(kind: EvidenceKind): void {
    this.failed.update((f) => ({ ...f, [kind]: true }));
  }
}
