import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiError } from '../../services/api.service';
import { AdminService, EvidenceReview, PendingPolicy, ReviewResult } from '../../services/admin.service';
import { PolicyChainService } from '../../services/policy-chain.service';
import { EvidenceKind, EvidenceMetaDto } from '../../models/policy.models';
import { errorMessage, isMissingEndpoint } from '../../utils/api-helpers';
import { explorerTxUrl, formatEth, formatVnDateTime, mapUrl, perilIcon, perilLabel, shortHash } from '../../utils/format';
import { describeChainError } from '../../utils/chain-errors';

const MAX_EXIF_DISTANCE_M = 300;
const NOTE_MIN = 5;
const NOTE_MAX = 500;

interface EvidenceView {
  loading: boolean;
  error: string | null;
  review: EvidenceReview | null;
}

const PHOTO_LABELS: Record<EvidenceKind, string> = { selfie: 'Chân dung', field: 'Ruộng', document: 'Giấy tờ đất' };

/**
 * Duyệt hồ sơ (SPEC-B mục 9.4.7), route /admin/review dưới staffGuard('admin').
 * Danh sách chờ duyệt do A phục vụ (GET /api/admin/pending-policies). Server kiểm lại hash khi duyệt, UI chỉ chặn sớm.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly chain = inject(PolicyChainService);

  readonly kinds: EvidenceKind[] = ['selfie', 'field', 'document'];
  readonly photoLabels = PHOTO_LABELS;
  readonly noteMax = NOTE_MAX;

  readonly policies = signal<PendingPolicy[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly endpointMissing = signal(false);

  readonly evidence = signal<Record<number, EvidenceView>>({});
  readonly notes = signal<Record<number, string>>({});
  readonly noteErrors = signal<Record<number, string>>({});
  readonly cardErrors = signal<Record<number, string>>({});
  readonly failedImages = signal<Record<string, boolean>>({});

  readonly confirming = signal<{ id: number; approved: boolean } | null>(null);
  readonly processingId = signal<number | null>(null);
  readonly result = signal<ReviewResult | null>(null);

  readonly manualId = signal('');
  readonly manualBusy = signal(false);
  readonly manualError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  // ===== Danh sách =====

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.endpointMissing.set(false);
    try {
      const list = await this.admin.pending();
      // Giữ lại các policy mở thủ công theo mã nếu vẫn chưa nằm trong danh sách.
      const manual = this.policies().filter((p) => p.farmerName === null && p.productName === null && !list.some((x) => x.policyId === p.policyId));
      this.policies.set([...manual, ...list]);
    } catch (e) {
      if (isMissingEndpoint(e)) {
        this.endpointMissing.set(true);
      } else {
        this.error.set(errorMessage(e, 'Không lấy được danh sách hồ sơ chờ duyệt'));
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Mở hồ sơ theo mã policy (dùng khi danh sách chờ duyệt chưa có hoặc cần tìm một policy cụ thể). */
  async openById(): Promise<void> {
    this.manualError.set(null);
    const id = Number(this.manualId().trim());
    if (!Number.isInteger(id) || id <= 0) {
      this.manualError.set('Nhập mã policy là số nguyên dương');
      return;
    }
    if (this.policies().some((p) => p.policyId === id)) {
      void this.openEvidence(id);
      return;
    }

    this.manualBusy.set(true);
    try {
      const policy = await this.chain.getPolicy(id);
      if (!policy) throw new Error('Không tìm thấy policy này');
      if (policy.status !== 0) throw new Error('Policy không còn ở trạng thái chờ xác minh');

      this.policies.update((list) => [
        {
          policyId: policy.policyId,
          holder: policy.holder,
          latE6: policy.latE6,
          lngE6: policy.lngE6,
          coverageWei: policy.coverageWei,
          productName: null,
          perilType: null,
          hasEvidence: null,
          evidenceSubmittedAt: null,
          farmerName: null,
          farmerPhone: null,
        },
        ...list,
      ]);
      this.manualId.set('');
      void this.openEvidence(id);
    } catch (e) {
      this.manualError.set(e instanceof Error ? e.message : describeChainError(e));
    } finally {
      this.manualBusy.set(false);
    }
  }

  // ===== Hồ sơ =====

  ev(id: number): EvidenceView | undefined {
    return this.evidence()[id];
  }

  async openEvidence(id: number): Promise<void> {
    this.setEvidence(id, { loading: true, error: null, review: null });
    this.failedImages.update((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith(`${id}-`))));
    try {
      const review = await this.admin.loadEvidence(id);
      this.setEvidence(id, { loading: false, error: null, review });
    } catch (e) {
      this.setEvidence(id, { loading: false, error: errorMessage(e, 'Không tải được hồ sơ'), review: null });
    }
  }

  closeEvidence(id: number): void {
    this.evidence.update((all) => Object.fromEntries(Object.entries(all).filter(([k]) => Number(k) !== id)));
    if (this.confirming()?.id === id) this.confirming.set(null);
  }

  private setEvidence(id: number, view: EvidenceView): void {
    this.evidence.update((all) => ({ ...all, [id]: view }));
  }

  markImageFailed(id: number, kind: EvidenceKind): void {
    this.failedImages.update((f) => ({ ...f, [`${id}-${kind}`]: true }));
  }

  imageFailed(id: number, kind: EvidenceKind): boolean {
    return !!this.failedImages()[`${id}-${kind}`];
  }

  /** Chỉ bật nút Duyệt khi đã mở hồ sơ, có ảnh trên máy chủ, đã có hash on-chain và hai bên khớp nhau. */
  canApprove(id: number): boolean {
    const e = this.ev(id);
    const r = e?.review;
    return !!e && !e.loading && !!r && !!r.meta && !!r.onChain && r.onChain.submittedAt > 0 && r.hashMatch;
  }

  approveHint(id: number): string {
    const e = this.ev(id);
    if (!e) return 'Hãy mở hồ sơ để kiểm tra trước khi duyệt';
    if (e.loading) return 'Đang tải hồ sơ';
    const r = e.review;
    if (!r?.meta) return 'Chưa có ảnh trên máy chủ';
    if (!r.onChain || r.onChain.submittedAt === 0) return 'Nông dân chưa gửi hash lên blockchain';
    if (!r.hashMatch) return 'Hash on-chain không khớp ảnh trên máy chủ';
    return '';
  }

  distanceWarning(meta: EvidenceMetaDto): boolean {
    return !meta.exifGpsPresent || (meta.distanceMeters ?? 0) > MAX_EXIF_DISTANCE_M;
  }

  distanceText(meta: EvidenceMetaDto): string {
    if (!meta.exifGpsPresent || meta.distanceMeters === null) return 'Ảnh ruộng không có GPS trong EXIF (cần đối chiếu thủ công)';
    return `EXIF lệch ${meta.distanceMeters.toFixed(0)} m so với GPS khai báo${meta.distanceMeters > MAX_EXIF_DISTANCE_M ? ` (vượt ${MAX_EXIF_DISTANCE_M} m)` : ''}`;
  }

  // ===== Quyết định =====

  noteOf(id: number): string {
    return this.notes()[id] ?? '';
  }

  setNote(id: number, value: string): void {
    this.notes.update((n) => ({ ...n, [id]: value }));
    if (this.noteErrors()[id]) this.setNoteError(id, null);
  }

  private setNoteError(id: number, message: string | null): void {
    this.noteErrors.update((all) => {
      const { [id]: _removed, ...rest } = all;
      return message ? { ...rest, [id]: message } : rest;
    });
  }

  private setCardError(id: number, message: string | null): void {
    this.cardErrors.update((all) => {
      const { [id]: _removed, ...rest } = all;
      return message ? { ...rest, [id]: message } : rest;
    });
  }

  /** Bước 1: kiểm tra ghi chú rồi hỏi xác nhận. */
  ask(id: number, approved: boolean): void {
    this.setCardError(id, null);
    const note = this.noteOf(id).trim();
    if (!approved && note.length < NOTE_MIN) {
      this.setNoteError(id, `Phải nhập lý do từ chối (ít nhất ${NOTE_MIN} ký tự)`);
      return;
    }
    if (note.length > NOTE_MAX) {
      this.setNoteError(id, `Ghi chú tối đa ${NOTE_MAX} ký tự`);
      return;
    }
    if (approved && !this.canApprove(id)) return;
    this.confirming.set({ id, approved });
  }

  cancelConfirm(): void {
    this.confirming.set(null);
  }

  /** Bước 2: gửi quyết định (ghi lên blockchain, có thể mất vài giây). */
  async confirm(): Promise<void> {
    const c = this.confirming();
    if (!c || this.processingId() !== null) return;

    this.processingId.set(c.id);
    this.setCardError(c.id, null);
    try {
      const note = this.noteOf(c.id).trim();
      const res = await this.admin.review(c.id, c.approved, note || null);
      this.result.set(res);
      this.confirming.set(null);
      this.policies.update((list) => list.filter((p) => p.policyId !== c.id));
      this.closeEvidence(c.id);
      this.notes.update((n) => Object.fromEntries(Object.entries(n).filter(([k]) => Number(k) !== c.id)));
      void this.load();
    } catch (e) {
      this.confirming.set(null);
      if (e instanceof ApiError && e.fields?.['note']) this.setNoteError(c.id, e.fields['note']);
      this.setCardError(c.id, errorMessage(e, 'Gửi quyết định thất bại'));
      // 409: policy không còn chờ xác minh (admin khác đã xử lý) → làm mới danh sách.
      if (e instanceof ApiError && e.status === 409) void this.load();
      // 422: hash/hồ sơ lệch so với kiểm tra ở server → tải lại hồ sơ để cập nhật cờ.
      if (e instanceof ApiError && e.status === 422) void this.openEvidence(c.id);
    } finally {
      this.processingId.set(null);
    }
  }

  dismissResult(): void {
    this.result.set(null);
  }

  // ===== Hiển thị =====

  perilIcon = perilIcon;
  perilLabel = perilLabel;
  formatEth = formatEth;
  shortHash = shortHash;
  time = formatVnDateTime;
  mapUrl = mapUrl;
  txUrl = explorerTxUrl;

  shortAddress(address: string): string {
    return address ? `${address.slice(0, 8)}…${address.slice(-6)}` : '';
  }
}
