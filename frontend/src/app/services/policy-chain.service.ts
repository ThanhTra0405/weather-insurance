import { Injectable, inject } from '@angular/core';
import { Contract, Interface } from 'ethers';
import { environment } from '../../environments/environment';
import POLICY_MANAGER_ARTIFACT from '../../assets/abi/PolicyManager.json';
import { ProductDto } from '../models/policy.models';
import { thresholdText } from '../utils/format';
import { Web3Service } from './web3.service';

/** Policy đọc thẳng từ contract (mapping `policies`). */
export interface ChainPolicy {
  policyId: number;
  productId: number;
  holder: string; // viết thường
  latE6: number;
  lngE6: number;
  regionId: string;
  startTime: number;
  endTime: number;
  premiumWei: string;
  coverageWei: string;
  status: number;
}

export interface ChainEvidence {
  fieldHash: string;
  documentHash: string;
  submittedAt: number;
}

const MAX_PRODUCTS = 50;

/**
 * Đọc PolicyManager trực tiếp (chỉ đọc, qua RPC của frontend). Dùng cho: kiểm tra evidence on-chain khi
 * tiếp tục gửi hồ sơ, đọc PolicyCreated từ receipt, và làm phương án dự phòng khi backend của A
 * (/api/products, /api/policies/*) chưa có. Không dùng getLogs.
 * Lưu ý: file ABI trong assets do A cập nhật (H2); hàm nào ABI chưa có thì trả lỗi và nơi gọi tự xử lý.
 */
@Injectable({ providedIn: 'root' })
export class PolicyChainService {
  private readonly web3 = inject(Web3Service);
  private readonly iface = new Interface(POLICY_MANAGER_ARTIFACT.abi);

  private contract(): Contract {
    return new Contract(environment.policyManagerAddress, POLICY_MANAGER_ARTIFACT.abi, this.web3.getProvider());
  }

  async listProducts(): Promise<ProductDto[]> {
    const c = this.contract();
    const next = Number(await c['nextProductId']());
    const result: ProductDto[] = [];

    for (let id = 1; id < next && id <= MAX_PRODUCTS; id++) {
      const p = await c['products'](id);
      if (BigInt(p.id) === 0n) continue;
      const peril = Number(p.perilType);
      result.push({
        productId: Number(p.id),
        name: String(p.name),
        perilType: peril,
        threshold: BigInt(p.threshold).toString(),
        thresholdDisplay: thresholdText(peril, BigInt(p.threshold)),
        durationDays: Number(p.durationDays),
        premiumWei: BigInt(p.premium).toString(),
        coverageWei: BigInt(p.coverageAmount).toString(),
        active: Boolean(p.active),
      });
    }
    return result;
  }

  /** null nếu policy không tồn tại. */
  async getPolicy(policyId: bigint | number): Promise<ChainPolicy | null> {
    const p = await this.contract()['policies'](BigInt(policyId));
    if (BigInt(p.id) === 0n) return null;

    return {
      policyId: Number(p.id),
      productId: Number(p.productId),
      holder: String(p.holder).toLowerCase(),
      latE6: Number(p.lat),
      lngE6: Number(p.lng),
      regionId: String(p.regionId),
      startTime: Number(p.startTime),
      endTime: Number(p.endTime),
      premiumWei: BigInt(p.premiumPaid).toString(),
      coverageWei: BigInt(p.coverageAmount).toString(),
      status: Number(p.status),
    };
  }

  async policyIdsOf(address: string): Promise<number[]> {
    const ids = (await this.contract()['getPoliciesOf'](address)) as bigint[];
    return Array.from(ids, (id) => Number(id));
  }

  async getEvidence(policyId: bigint | number): Promise<ChainEvidence> {
    const e = await this.contract()['evidenceOf'](BigInt(policyId));
    return {
      fieldHash: String(e.fieldPhotoHash).toLowerCase(),
      documentHash: String(e.documentHash).toLowerCase(),
      submittedAt: Number(e.submittedAt),
    };
  }

  /** true nếu đã có hash bằng chứng on-chain; không đọc được (ABI cũ, lỗi RPC) thì coi như chưa có. */
  async hasEvidence(policyId: bigint | number): Promise<boolean> {
    try {
      return (await this.getEvidence(policyId)).submittedAt > 0;
    } catch {
      return false;
    }
  }

  /** Lấy policyId từ event PolicyCreated trong receipt của buyPolicy (không dùng "id cuối cùng của danh sách"). */
  parsePolicyCreated(receipt: { logs?: ReadonlyArray<{ address: string; topics: ReadonlyArray<string>; data: string }> } | null): bigint | null {
    const managerAddress = environment.policyManagerAddress.toLowerCase();

    for (const log of receipt?.logs ?? []) {
      if (String(log.address).toLowerCase() !== managerAddress) continue;
      try {
        const parsed = this.iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'PolicyCreated') return BigInt(parsed.args['policyId']);
      } catch {
        // log của event khác: bỏ qua
      }
    }
    return null;
  }
}
