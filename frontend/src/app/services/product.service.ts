import { Injectable, inject } from '@angular/core';
import { ProductDto } from '../models/policy.models';
import { isMissingEndpoint } from '../utils/api-helpers';
import { ApiService } from './api.service';
import { PolicyChainService } from './policy-chain.service';

/** Danh sách gói: GET /api/products (A). Backend chưa có endpoint thì đọc thẳng từ contract. */
@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly api = inject(ApiService);
  private readonly chain = inject(PolicyChainService);

  async list(): Promise<ProductDto[]> {
    try {
      const raw = await this.api.get<unknown>('/api/products');
      const items = Array.isArray(raw) ? raw : [];
      return items.map(toProduct);
    } catch (e) {
      if (!isMissingEndpoint(e)) throw e;
      return this.chain.listProducts();
    }
  }
}

function toProduct(raw: any): ProductDto {
  return {
    productId: Number(raw.productId),
    name: String(raw.name ?? ''),
    perilType: Number(raw.perilType ?? 0),
    threshold: String(raw.threshold ?? '0'),
    thresholdDisplay: String(raw.thresholdDisplay ?? ''),
    durationDays: Number(raw.durationDays ?? 0),
    premiumWei: String(raw.premiumWei ?? '0'),
    coverageWei: String(raw.coverageWei ?? '0'),
    active: raw.active !== false,
  };
}
