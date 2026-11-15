import { Injectable, inject } from '@angular/core';
import { Contract, parseEther } from 'ethers';
import { Web3Service } from './web3.service';
import { environment } from '../../environments/environment';
import POLICY_MANAGER_ARTIFACT from '../../assets/abi/PolicyManager.json';
import LIQUIDITY_POOL_ARTIFACT from '../../assets/abi/LiquidityPool.json';

export interface PoolStats {
  balance: bigint;
  deposited: bigint;
  locked: bigint;
  available: bigint;
}

export interface ProductView {
  id: number;
  name: string;
  perilType: number;
  threshold: bigint;
  durationDays: number;
  premium: bigint;
  coverageAmount: bigint;
  active: boolean;
}

@Injectable({ providedIn: 'root' })
export class ContractService {
  private web3 = inject(Web3Service);

  private policyManager(write = false): Contract {
    return new Contract(
      environment.policyManagerAddress,
      POLICY_MANAGER_ARTIFACT.abi,
      write ? this.web3.getSigner() : this.web3.getProvider()
    );
  }

  private pool(write = false): Contract {
    return new Contract(
      environment.liquidityPoolAddress,
      LIQUIDITY_POOL_ARTIFACT.abi,
      write ? this.web3.getSigner() : this.web3.getProvider()
    );
  }

  // ===== PolicyManager =====

  async buyPolicy(productId: number, latScaled: bigint, lngScaled: bigint, premiumEth: string) {
    const tx = await this.policyManager(true)['buyPolicy'](productId, latScaled, lngScaled, {
      value: parseEther(premiumEth),
    });
    return tx.wait();
  }

  async submitVerificationEvidence(policyId: bigint, fieldPhotoHash: string, documentHash: string) {
    const tx = await this.policyManager(true)['submitVerificationEvidence'](
      policyId,
      fieldPhotoHash,
      documentHash
    );
    return tx.wait();
  }

  async expirePolicy(policyId: bigint) {
    const tx = await this.policyManager(true)['expirePolicy'](policyId);
    return tx.wait();
  }

  async getProduct(productId: number) {
    return this.policyManager()['products'](productId);
  }

  /** Đọc toàn bộ sản phẩm trực tiếp từ chain (1..nextProductId-1). Trang chính nên dùng GET /api/products. */
  async listProducts(): Promise<ProductView[]> {
    const pm = this.policyManager();
    const next = Number(await pm['nextProductId']());
    const result: ProductView[] = [];
    for (let id = 1; id < next; id++) {
      const p = await pm['products'](id);
      result.push({
        id,
        name: p[1],
        perilType: Number(p[2]),
        threshold: p[3],
        durationDays: Number(p[4]),
        premium: p[5],
        coverageAmount: p[6],
        active: p[7],
      });
    }
    return result;
  }

  async getEvidence(policyId: bigint) {
    return this.policyManager()['evidenceOf'](policyId);
  }

  async getActivePolicies(address: string): Promise<bigint[]> {
    return this.policyManager()['getPoliciesOf'](address);
  }

  async getPolicy(policyId: bigint) {
    return this.policyManager()['getPolicy'](policyId);
  }

  // ===== LiquidityPool =====

  async getPoolStats(): Promise<PoolStats> {
    const [balance, deposited, locked, available] = await this.pool()['getPoolStats']();
    return { balance, deposited, locked, available };
  }

  async getMyShares(address: string): Promise<bigint> {
    return this.pool()['sharesOf'](address);
  }

  async getTotalShares(): Promise<bigint> {
    return this.pool()['totalShares']();
  }

  async provideLiquidity(ethAmount: string) {
    const tx = await this.pool(true)['provideLiquidity']({ value: parseEther(ethAmount) });
    return tx.wait();
  }

  async withdrawLiquidity(shares: bigint) {
    const tx = await this.pool(true)['withdrawLiquidity'](shares);
    return tx.wait();
  }
}
