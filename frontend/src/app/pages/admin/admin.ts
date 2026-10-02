import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, EvidenceMeta, PendingPolicy } from '../../services/admin.service';
import { ContractService } from '../../services/contract.service';

interface EvidenceView {
  loading: boolean;
  error?: string;
  meta: EvidenceMeta | null;
  images: { selfie: string; field: string; document: string } | null;
  onChain: boolean;
  hashMatch: boolean;
}

const MAX_EXIF_DISTANCE_M = 300;

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit, OnDestroy {
  private adminService = inject(AdminService);
  private contractService = inject(ContractService);

  readonly keyInput = signal('');
  readonly policies = signal<PendingPolicy[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly processingId = signal<number | null>(null);
  readonly evidence = signal<Record<number, EvidenceView>>({});

  get isLoggedIn(): boolean {
    return this.adminService.apiKey() !== null;
  }

  ngOnInit(): void {
    if (this.isLoggedIn) this.load();
  }

  ngOnDestroy(): void {
    this.closeAll();
  }

  async login(): Promise<void> {
    this.adminService.login(this.keyInput().trim());
    this.keyInput.set('');
    await this.load();
  }

  logout(): void {
    this.adminService.logout();
    this.policies.set([]);
    this.closeAll();
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      this.policies.set(await this.adminService.getPendingPolicies());
    } catch (err: any) {
      this.error.set(err.message);
      this.policies.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  async review(policyId: number, approved: boolean): Promise<void> {
    this.processingId.set(policyId);
    try {
      await this.adminService.reviewPolicy(policyId, approved);
      this.closeEvidence(policyId);
      await this.load();
    } catch (err: any) {
      this.error.set(err.message);
    } finally {
      this.processingId.set(null);
    }
  }

  // ===== Hồ sơ xác minh =====

  ev(policyId: number): EvidenceView | undefined {
    return this.evidence()[policyId];
  }

  async openEvidence(policyId: number): Promise<void> {
    this.setEv(policyId, { loading: true, meta: null, images: null, onChain: false, hashMatch: false });
    try {
      const [meta, chain] = await Promise.all([
        this.adminService.getEvidenceMeta(policyId),
        this.contractService.getEvidence(BigInt(policyId)),
      ]);

      const onChain = chain.submittedAt !== 0n;

      let images: EvidenceView['images'] = null;
      if (meta) {
        const [selfie, field, document] = await Promise.all([
          this.adminService.getEvidenceImage(policyId, 'selfie'),
          this.adminService.getEvidenceImage(policyId, 'field'),
          this.adminService.getEvidenceImage(policyId, 'document'),
        ]);
        images = { selfie, field, document };
      }

      const hashMatch =
        !!meta &&
        onChain &&
        String(chain.fieldPhotoHash).toLowerCase() === meta.fieldPhotoHash.toLowerCase() &&
        String(chain.documentHash).toLowerCase() === meta.documentHash.toLowerCase();

      this.setEv(policyId, { loading: false, meta, images, onChain, hashMatch });
    } catch (err: any) {
      this.setEv(policyId, {
        loading: false,
        error: err?.message ?? 'Không tải được hồ sơ',
        meta: null,
        images: null,
        onChain: false,
        hashMatch: false,
      });
    }
  }

  closeEvidence(policyId: number): void {
    const e = this.ev(policyId);
    if (e?.images) Object.values(e.images).forEach((u) => URL.revokeObjectURL(u));
    this.evidence.update((all) => {
      const { [policyId]: _removed, ...rest } = all;
      return rest;
    });
  }

  private closeAll(): void {
    Object.keys(this.evidence()).forEach((id) => this.closeEvidence(Number(id)));
  }

  private setEv(policyId: number, view: EvidenceView): void {
    this.evidence.update((all) => ({ ...all, [policyId]: view }));
  }

  /** Chỉ cho duyệt khi đã xem hồ sơ, hash on-chain khớp hash ảnh trên máy chủ */
  canApprove(policyId: number): boolean {
    const e = this.ev(policyId);
    return !!e && !e.loading && !!e.meta && e.onChain && e.hashMatch;
  }

  distanceWarning(meta: EvidenceMeta): boolean {
    return !meta.exifGpsPresent || (meta.distanceMeters ?? 0) > MAX_EXIF_DISTANCE_M;
  }

  distanceText(meta: EvidenceMeta): string {
    if (!meta.exifGpsPresent || meta.distanceMeters === null) {
      return 'Ảnh ruộng không có GPS trong EXIF (cần đối chiếu thủ công)';
    }
    return `EXIF lệch ${meta.distanceMeters.toFixed(0)} m so với GPS khai báo`;
  }

  formatLatLng(scaled: string): string {
    return (Number(scaled) / 1_000_000).toFixed(6);
  }
}