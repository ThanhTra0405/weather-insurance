import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ContractService } from '../../services/contract.service';
import { Web3Service } from '../../services/web3.service';

@Component({
  selector: 'app-buy-policy',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './buy-policy.html',
  styleUrl: './buy-policy.css',
})
export class BuyPolicy {
  private contractService = inject(ContractService);
  private web3 = inject(Web3Service);

  readonly lat = signal<number | null>(null);
  readonly lng = signal<number | null>(null);
  readonly gpsAccuracy = signal<number | null>(null);
  readonly gpsError = signal<string | null>(null);
  readonly isLoadingGps = signal(false);

  readonly productId = signal(1);
  readonly premiumEth = signal('0.1');
  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly submitSuccess = signal(false);

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

  async submit(): Promise<void> {
    if (!this.web3.isConnected) {
      this.submitError.set('Vui lòng kết nối ví trước');
      return;
    }
    if (this.lat() === null || this.lng() === null) {
      this.submitError.set('Vui lòng lấy vị trí GPS trước');
      return;
    }

    this.isSubmitting.set(true);
    this.submitError.set(null);
    this.submitSuccess.set(false);

    try {
      // Scale toạ độ 1e6, khớp đúng đơn vị contract đang dùng —
      // KHÔNG tự tính regionId ở đây, để contract tự tính on-chain
      const latScaled = BigInt(Math.round(this.lat()! * 1_000_000));
      const lngScaled = BigInt(Math.round(this.lng()! * 1_000_000));

      await this.contractService.buyPolicy(
        this.productId(),
        latScaled,
        lngScaled,
        this.premiumEth()
      );

      this.submitSuccess.set(true);
    } catch (err: any) {
      this.submitError.set(err?.reason ?? err?.message ?? 'Giao dịch thất bại');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}