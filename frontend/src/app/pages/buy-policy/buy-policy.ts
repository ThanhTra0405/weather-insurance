import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { formatEther } from 'ethers';
import { ContractService } from '../../services/contract.service';
import { EvidenceService } from '../../services/evidence.service';
import { Web3Service } from '../../services/web3.service';

type PhotoKind = 'selfie' | 'field' | 'document';
const MAX_GPS_ACCURACY_M = 200;

interface ProductView {
  name: string;
  premiumEth: string;
  coverageEth: string;
  durationDays: number;
}

@Component({
  selector: 'app-buy-policy',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './buy-policy.html',
  styleUrl: './buy-policy.css',
})
export class BuyPolicy {
  private contractService = inject(ContractService);
  private evidence = inject(EvidenceService);
  private web3 = inject(Web3Service);

  readonly lat = signal<number | null>(null);
  readonly lng = signal<number | null>(null);
  readonly gpsAccuracy = signal<number | null>(null);
  readonly gpsError = signal<string | null>(null);
  readonly isLoadingGps = signal(false);

  readonly photos = signal<Record<PhotoKind, File | null>>({
    selfie: null,
    field: null,
    document: null,
  });

  readonly productId = signal(1);
  readonly product = signal<ProductView | null>(null);
  readonly productError = signal<string | null>(null);

  readonly isSubmitting = signal(false);
  readonly step = signal<string | null>(null);
  readonly submitError = signal<string | null>(null);
  readonly submitSuccess = signal(false);

  // Đã mua policy nhưng gửi hồ sơ lỗi → lần bấm sau chỉ gửi lại hồ sơ, không mua lần 2
  private pendingPolicyId: bigint | null = null;

  constructor() {
    void this.loadProduct(this.productId());
  }

  onProductChange(id: number): void {
    this.productId.set(id);
    void this.loadProduct(id);
  }

  private async loadProduct(id: number): Promise<void> {
    this.product.set(null);
    this.productError.set(null);
    try {
      const p = await this.contractService.getProduct(id);
      if (p.id === 0n || !p.active) {
        this.productError.set('Gói bảo hiểm không tồn tại hoặc đã ngừng bán');
        return;
      }
      this.product.set({
        name: p.name,
        premiumEth: formatEther(p.premium),
        coverageEth: formatEther(p.coverageAmount),
        durationDays: Number(p.durationDays),
      });
    } catch (err: any) {
      this.productError.set(err?.message ?? 'Không tải được gói bảo hiểm');
    }
  }

  getGps(): void {
    if (!navigator.geolocation) {
      this.gpsError.set('Trình duyệt không hỗ trợ GPS');
      return;
    }

    this.isLoadingGps.set(true);
    this.gpsError.set(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.lat.set(pos.coords.latitude);
        this.lng.set(pos.coords.longitude);
        this.gpsAccuracy.set(pos.coords.accuracy);
        this.isLoadingGps.set(false);
      },
      (err) => {
        this.gpsError.set('Không lấy được vị trí: ' + err.message);
        this.isLoadingGps.set(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  onPhoto(kind: PhotoKind, ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.photos.update((p) => ({ ...p, [kind]: file }));
  }

  async submit(): Promise<void> {
    this.submitError.set(null);
    this.submitSuccess.set(false);

    await this.web3.ready;
    const address = this.web3.address();
    if (!address) {
      this.submitError.set('Ví chưa sẵn sàng, thử tải lại trang');
      return;
    }

    const product = this.product();
    if (!product) {
      this.submitError.set('Chưa chọn được gói bảo hiểm hợp lệ');
      return;
    }

    const lat = this.lat();
    const lng = this.lng();
    const accuracy = this.gpsAccuracy();
    if (lat === null || lng === null || accuracy === null) {
      this.submitError.set('Vui lòng lấy vị trí GPS trước');
      return;
    }
    if (accuracy > MAX_GPS_ACCURACY_M) {
      this.submitError.set(
        `GPS chưa đủ chính xác (±${accuracy.toFixed(0)}m). Hãy ra chỗ thoáng và lấy lại vị trí`
      );
      return;
    }

    const { selfie, field, document: docPhoto } = this.photos();
    if (!selfie || !field || !docPhoto) {
      this.submitError.set('Cần đủ 3 ảnh: chân dung, ruộng, giấy tờ đất');
      return;
    }

    this.isSubmitting.set(true);
    try {
      if (this.pendingPolicyId === null) {
        this.step.set('Đang mua bảo hiểm...');
        await this.contractService.buyPolicy(
          this.productId(),
          BigInt(Math.round(lat * 1_000_000)),
          BigInt(Math.round(lng * 1_000_000)),
          product.premiumEth
        );
        const ids = await this.contractService.getActivePolicies(address);
        this.pendingPolicyId = ids[ids.length - 1];
      }
      const policyId = this.pendingPolicyId;

      this.step.set('Đang gửi hồ sơ xác minh...');
      const [fieldHash, docHash] = await Promise.all([
        this.evidence.sha256(field),
        this.evidence.sha256(docPhoto),
      ]);
      await this.evidence.upload(
        policyId,
        { selfie, field, document: docPhoto },
        { lat, lng, accuracy },
        address
      );

      this.step.set('Đang ghi bằng chứng lên blockchain...');
      await this.contractService.submitVerificationEvidence(policyId, fieldHash, docHash);

      this.pendingPolicyId = null;
      this.submitSuccess.set(true);
    } catch (err: any) {
      const msg = err?.reason ?? err?.message ?? 'Giao dịch thất bại';
      this.submitError.set(
        this.pendingPolicyId !== null
          ? `Đã mua policy #${this.pendingPolicyId} nhưng gửi hồ sơ lỗi: ${msg}. Bấm gửi lại.`
          : msg
      );
    } finally {
      this.isSubmitting.set(false);
      this.step.set(null);
    }
  }
}