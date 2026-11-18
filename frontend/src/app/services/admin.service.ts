import { Injectable, inject } from '@angular/core';
import { EvidenceKind, EvidenceMetaDto } from '../models/policy.models';
import { ApiService } from './api.service';
import { ChainEvidence, PolicyChainService } from './policy-chain.service';
import { PolicyService } from './policy.service';

/** Một policy đang chờ duyệt (GET /api/admin/pending-policies, do A phục vụ). */
export interface PendingPolicy {
  policyId: number;
  holder: string;
  latE6: number;
  lngE6: number;
  coverageWei: string;
  productName: string | null;
  perilType: number | null;
  hasEvidence: boolean | null;
  evidenceSubmittedAt: number | null; // unix giây
  farmerName: string | null;
  farmerPhone: string | null;
}

export interface EvidenceReview {
  meta: EvidenceMetaDto | null;
  images: Record<EvidenceKind, string | null>;
  onChain: ChainEvidence | null;
  /** Hash on-chain trùng hash của ảnh lưu trên máy chủ (cả ảnh ruộng và ảnh giấy tờ). */
  hashMatch: boolean;
}

export interface ReviewResult {
  policyId: number;
  approved: boolean;
  txHash: string;
}

/** Duyệt hồ sơ (admin): danh sách chờ duyệt, hồ sơ + hash on-chain, gửi quyết định. Mọi request qua ApiService (Bearer JWT). */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly api = inject(ApiService);
  private readonly policies = inject(PolicyService);
  private readonly chain = inject(PolicyChainService);

  async pending(): Promise<PendingPolicy[]> {
    const raw = await this.api.get<unknown>('/api/admin/pending-policies');
    const list = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] } | null)?.items ?? []);
    return list.map(toPending);
  }

  /** Tải meta + ảnh (signed URL, hết hạn sau 5 phút) + hash on-chain, rồi tự so hash. */
  async loadEvidence(policyId: number): Promise<EvidenceReview> {
    const [meta, onChain] = await Promise.all([
      this.policies.evidenceMeta(policyId),
      this.chain.getEvidence(policyId).catch(() => null),
    ]);

    const images: Record<EvidenceKind, string | null> = { selfie: null, field: null, document: null };
    if (meta) {
      const kinds: EvidenceKind[] = ['selfie', 'field', 'document'];
      await Promise.all(
        kinds.map(async (kind) => {
          try {
            images[kind] = await this.policies.evidenceImageUrl(policyId, kind);
          } catch {
            images[kind] = null;
          }
        }),
      );
    }

    const hashMatch =
      !!meta &&
      !!onChain &&
      onChain.submittedAt > 0 &&
      onChain.fieldHash === meta.fieldPhotoHash.toLowerCase() &&
      onChain.documentHash === meta.documentHash.toLowerCase();

    return { meta, images, onChain, hashMatch };
  }

  /** POST /api/admin/review/{id}. Server kiểm hash lại, ghi review_logs, gửi tx, ghi audit. */
  review(policyId: number, approved: boolean, note: string | null): Promise<ReviewResult> {
    return this.api.post<ReviewResult>(`/api/admin/review/${policyId}`, { approved, note });
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Số giây Unix từ số, chuỗi số hoặc chuỗi ISO; null nếu không có. */
function toUnixSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : value;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value);
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

function toPending(raw: any): PendingPolicy {
  return {
    policyId: toNumber(raw.policyId),
    holder: String(raw.holder ?? '').toLowerCase(),
    latE6: Math.round(Number(raw.lat) * 1_000_000),
    lngE6: Math.round(Number(raw.lng) * 1_000_000),
    coverageWei: raw.coverageAmountWei,
    productName: raw.productName ?? null,
    perilType: raw.perilType === undefined || raw.perilType === null ? null : toNumber(raw.perilType),
    hasEvidence: typeof raw.hasEvidence === 'boolean' ? raw.hasEvidence : null,
    evidenceSubmittedAt: toUnixSeconds(raw.evidenceSubmittedAt),
    farmerName: raw.farmerName ?? null,
    farmerPhone: raw.farmerPhone ?? null,
  };
}
