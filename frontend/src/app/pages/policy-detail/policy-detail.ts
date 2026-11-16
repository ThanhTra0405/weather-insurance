import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EvidenceKind, EvidenceMetaDto, PolicyDetail, TimelineEvent } from '../../models/policy.models';
import { ApiError } from '../../services/api.service';
import { PolicyService } from '../../services/policy.service';
import { errorMessage } from '../../utils/api-helpers';
import {
  explorerTxUrl,
  formatEth,
  formatVnDateTime,
  mapUrl,
  perilIcon,
  perilLabel,
  policyStatusView,
  remainingText,
} from '../../utils/format';

type StepState = 'done' | 'pending' | 'rejected' | 'skipped';

interface TimelineStep {
  key: string;
  title: string;
  state: StepState;
  time: number | null;
  txHash: string | null;
  note: string | null;
}

interface PhotoView {
  kind: EvidenceKind;
  label: string;
  url: string | null;
  failed: boolean;
}

const PHOTO_LABELS: Record<EvidenceKind, string> = { selfie: 'Chân dung', field: 'Ruộng', document: 'Giấy tờ đất' };

/** Chi tiết policy (SPEC-B mục 9.3.4): thông tin, bản đồ, timeline, lý do từ chối, ảnh hồ sơ, link tx. */
@Component({
  selector: 'app-policy-detail',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './policy-detail.html',
  styleUrl: './policy-detail.css',
})
export class PolicyDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly policyService = inject(PolicyService);

  readonly policyId = signal<number | null>(null);
  readonly policy = signal<PolicyDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notFound = signal(false);

  readonly meta = signal<EvidenceMetaDto | null>(null);
  readonly photos = signal<PhotoView[]>([]);
  readonly photosLoading = signal(false);
  readonly photosError = signal<string | null>(null);

  readonly statusView = computed(() => {
    const p = this.policy();
    return p ? policyStatusView(p.status, this.isRejected()) : null;
  });

  /** Bị từ chối: có lý do từ chối, hoặc timeline có sự kiện duyệt với approved = false. */
  readonly isRejected = computed(() => {
    const p = this.policy();
    if (!p) return false;
    if (p.rejectReason) return true;
    return p.timeline.some((e) => e.type === 'verified' && e.data['approved'] === false);
  });

  readonly steps = computed<TimelineStep[]>(() => {
    const p = this.policy();
    return p ? buildSteps(p, this.isRejected()) : [];
  });

  readonly canSendEvidence = computed(() => {
    const p = this.policy();
    if (!p || p.status !== 0) return false;
    return !p.timeline.some((e) => e.type === 'evidence');
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = Number(params.get('id'));
      if (!Number.isInteger(id) || id <= 0) {
        this.policyId.set(null);
        this.loading.set(false);
        this.notFound.set(true);
        return;
      }
      this.policyId.set(id);
      void this.load(id);
    });
  }

  async load(id: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.notFound.set(false);
    this.policy.set(null);
    this.meta.set(null);
    this.photos.set([]);
    try {
      this.policy.set(await this.policyService.detail(id));
      void this.loadPhotos(id);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        this.notFound.set(true);
      } else {
        this.error.set(errorMessage(e, 'Không tải được thông tin policy'));
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Ảnh hồ sơ của mình qua signed URL (hết hạn sau 5 phút, bấm tải lại để lấy link mới). */
  async loadPhotos(id: number): Promise<void> {
    this.photosLoading.set(true);
    this.photosError.set(null);
    try {
      const meta = await this.policyService.evidenceMeta(id);
      this.meta.set(meta);
      if (!meta) {
        this.photos.set([]);
        return;
      }

      const kinds: EvidenceKind[] = ['selfie', 'field', 'document'];
      const views = await Promise.all(
        kinds.map(async (kind): Promise<PhotoView> => {
          try {
            return { kind, label: PHOTO_LABELS[kind], url: await this.policyService.evidenceImageUrl(id, kind), failed: false };
          } catch {
            return { kind, label: PHOTO_LABELS[kind], url: null, failed: true };
          }
        }),
      );
      this.photos.set(views);
    } catch (e) {
      this.photosError.set(errorMessage(e, 'Không tải được ảnh hồ sơ'));
    } finally {
      this.photosLoading.set(false);
    }
  }

  markPhotoFailed(kind: EvidenceKind): void {
    this.photos.update((list) => list.map((p) => (p.kind === kind ? { ...p, failed: true } : p)));
  }

  remaining(p: PolicyDetail): string {
    return remainingText(p.status, p.startTime, p.endTime);
  }

  perilIcon = perilIcon;
  perilLabel = perilLabel;
  formatEth = formatEth;
  formatTime = formatVnDateTime;
  mapUrl = mapUrl;
  txUrl = explorerTxUrl;

  payoutAmount(p: PolicyDetail): string | null {
    const wei = p.timeline.find((e) => e.type === 'payout')?.data['amountWei'];
    return typeof wei === 'string' || typeof wei === 'number' ? formatEth(wei) : null;
  }
}

function buildSteps(p: PolicyDetail, rejected: boolean): TimelineStep[] {
  const find = (type: TimelineEvent['type']) => p.timeline.find((e) => e.type === type);
  const created = find('created');
  const evidence = find('evidence');
  const verified = find('verified');
  const payout = find('payout');
  const expired = find('expired');

  const steps: TimelineStep[] = [];

  steps.push({
    key: 'created',
    title: 'Đã mua bảo hiểm',
    state: 'done',
    time: created?.time ?? null,
    txHash: created?.txHash ?? null,
    note: null,
  });

  steps.push({
    key: 'evidence',
    title: evidence || p.status !== 0 ? 'Đã gửi hồ sơ xác minh' : 'Gửi hồ sơ xác minh',
    state: evidence || p.status !== 0 ? 'done' : 'pending',
    time: evidence?.time ?? null,
    txHash: evidence?.txHash ?? null,
    note: !evidence && p.status === 0 ? 'Bạn chưa gửi hồ sơ' : null,
  });

  if (rejected) {
    steps.push({
      key: 'verified',
      title: 'Hồ sơ bị từ chối',
      state: 'rejected',
      time: verified?.time ?? null,
      txHash: verified?.txHash ?? null,
      note: p.rejectReason,
    });
    return steps;
  }

  const approved = verified?.data['approved'] === true || p.status === 1 || p.status === 2;
  steps.push({
    key: 'verified',
    title: approved ? 'Đã được duyệt' : 'Chờ duyệt',
    state: approved ? 'done' : 'pending',
    time: verified?.time ?? null,
    txHash: verified?.txHash ?? null,
    note: null,
  });

  if (payout || p.status === 2) {
    steps.push({ key: 'payout', title: 'Đã bồi thường', state: 'done', time: payout?.time ?? null, txHash: payout?.txHash ?? null, note: null });
  } else if (expired || p.status === 3) {
    steps.push({
      key: 'expired',
      title: 'Đã hết hạn / đóng',
      state: 'done',
      time: expired?.time ?? null,
      txHash: expired?.txHash ?? null,
      note: expired?.data['refunded'] === true ? 'Phí bảo hiểm đã được hoàn lại' : null,
    });
  } else {
    steps.push({
      key: 'payout',
      title: 'Bồi thường hoặc hết hạn',
      state: 'pending',
      time: null,
      txHash: null,
      note: p.status === 1 ? 'Hệ thống theo dõi dữ liệu thời tiết và tự bồi thường khi đạt ngưỡng' : null,
    });
  }
  return steps;
}
