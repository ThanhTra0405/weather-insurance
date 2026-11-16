import { Injectable, inject } from '@angular/core';
import {
  EvidenceKind,
  EvidenceMetaDto,
  PolicyDetail,
  PolicySummary,
  ProductDto,
  TimelineEvent,
  TimelineType,
} from '../models/policy.models';
import { ApiError, ApiService } from './api.service';
import { isMissingEndpoint } from '../utils/api-helpers';
import { ChainPolicy, PolicyChainService } from './policy-chain.service';
import { ProductService } from './product.service';
import { Web3Service } from './web3.service';

const TIMELINE_TYPES: TimelineType[] = ['created', 'evidence', 'verified', 'payout', 'expired'];

/**
 * Policy của nông dân: GET /api/policies/mine và /api/policies/{id} (A, dữ liệu từ indexer).
 * Endpoint chưa có thì đọc thẳng từ blockchain (không có timeline và lý do từ chối).
 */
@Injectable({ providedIn: 'root' })
export class PolicyService {
  private readonly api = inject(ApiService);
  private readonly chain = inject(PolicyChainService);
  private readonly products = inject(ProductService);
  private readonly web3 = inject(Web3Service);

  async mine(): Promise<PolicySummary[]> {
    let items: PolicySummary[];
    try {
      const raw = await this.api.get<unknown>('/api/policies/mine');
      const list = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] } | null)?.items ?? []);
      items = list.map(toSummary);
    } catch (e) {
      if (!isMissingEndpoint(e)) throw e;
      items = await this.mineFromChain();
    }

    // Policy đang chờ xác minh: hỏi blockchain xem đã gửi hash chưa (quyết định nút "Gửi hồ sơ").
    await Promise.all(
      items
        .filter((p) => p.status === 0 && p.hasEvidence === undefined)
        .map(async (p) => {
          p.hasEvidence = await this.chain.hasEvidence(p.policyId);
        }),
    );

    return items.sort((a, b) => b.policyId - a.policyId);
  }

  async detail(policyId: number): Promise<PolicyDetail> {
    try {
      const raw = await this.api.get<any>(`/api/policies/${policyId}`);
      return toDetail(raw);
    } catch (e) {
      if (!isMissingEndpoint(e)) throw e;
      return this.detailFromChain(policyId);
    }
  }

  /** Meta hồ sơ của mình; null nếu chưa upload. */
  async evidenceMeta(policyId: number): Promise<EvidenceMetaDto | null> {
    try {
      return await this.api.get<EvidenceMetaDto>(`/api/evidence/${policyId}/meta`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  /** Signed URL của ảnh (hết hạn sau 5 phút). */
  async evidenceImageUrl(policyId: number, kind: EvidenceKind): Promise<string> {
    const res = await this.api.get<{ url: string; expiresIn: number }>(`/api/evidence/${policyId}/${kind}`);
    return res.url;
  }

  // ===== Dự phòng: đọc từ blockchain =====

  private async mineFromChain(): Promise<PolicySummary[]> {
    await this.web3.ready;
    const address = this.web3.address();
    if (!address) throw new Error('Ví chưa sẵn sàng, thử tải lại trang');

    const [ids, products] = await Promise.all([this.chain.policyIdsOf(address), this.productMap()]);
    const policies = await Promise.all(ids.map((id) => this.chain.getPolicy(id)));

    return policies
      .filter((p): p is ChainPolicy => p !== null)
      .map((p) => ({
        policyId: p.policyId,
        productId: p.productId,
        productName: products.get(p.productId)?.name ?? null,
        perilType: products.get(p.productId)?.perilType ?? 0,
        status: p.status,
        rejected: false,
        startTime: p.startTime,
        endTime: p.endTime,
        premiumWei: p.premiumWei,
        coverageWei: p.coverageWei,
      }));
  }

  private async detailFromChain(policyId: number): Promise<PolicyDetail> {
    const policy = await this.chain.getPolicy(policyId);
    if (!policy) throw new ApiError(404, 'Không tìm thấy policy');

    const products = await this.productMap();
    return {
      ...policy,
      productName: products.get(policy.productId)?.name ?? null,
      perilType: products.get(policy.productId)?.perilType ?? 0,
      rejectReason: null,
      timeline: [],
      source: 'chain',
    };
  }

  private async productMap(): Promise<Map<number, ProductDto>> {
    try {
      return new Map((await this.products.list()).map((p) => [p.productId, p] as [number, ProductDto]));
    } catch {
      return new Map();
    }
  }
}

function toSummary(raw: any): PolicySummary {
  return {
    policyId: Number(raw.policyId),
    productId: Number(raw.productId ?? 0),
    productName: raw.productName ?? null,
    perilType: Number(raw.perilType ?? 0),
    status: Number(raw.status ?? 0),
    rejected: raw.rejected === true,
    startTime: Number(raw.startTime ?? 0),
    endTime: Number(raw.endTime ?? 0),
    premiumWei: String(raw.premiumWei ?? '0'),
    coverageWei: String(raw.coverageWei ?? raw.coverageAmountWei ?? '0'),
    hasEvidence: typeof raw.hasEvidence === 'boolean' ? raw.hasEvidence : undefined,
  };
}

function toDetail(raw: any): PolicyDetail {
  const timeline: TimelineEvent[] = (Array.isArray(raw.timeline) ? raw.timeline : [])
    .filter((e: any) => TIMELINE_TYPES.includes(e?.type))
    .map((e: any) => ({
      type: e.type as TimelineType,
      time: Number(e.time ?? 0),
      txHash: e.txHash ?? null,
      data: e.data && typeof e.data === 'object' ? e.data : {},
    }))
    .sort((a: TimelineEvent, b: TimelineEvent) => a.time - b.time);

  return {
    policyId: Number(raw.policyId),
    productId: Number(raw.productId ?? 0),
    productName: raw.productName ?? null,
    perilType: Number(raw.perilType ?? 0),
    holder: String(raw.holder ?? '').toLowerCase(),
    latE6: Number(raw.latE6 ?? 0),
    lngE6: Number(raw.lngE6 ?? 0),
    regionId: String(raw.regionId ?? ''),
    status: Number(raw.status ?? 0),
    startTime: Number(raw.startTime ?? 0),
    endTime: Number(raw.endTime ?? 0),
    premiumWei: String(raw.premiumWei ?? '0'),
    coverageWei: String(raw.coverageWei ?? '0'),
    rejectReason: raw.rejectReason ?? null,
    timeline,
    source: 'api',
  };
}
