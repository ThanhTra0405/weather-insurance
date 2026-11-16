import { Component, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { formatEther, parseEther } from 'ethers';
import { ProductDto } from '../../models/policy.models';
import { ApiError } from '../../services/api.service';
import { ContractService } from '../../services/contract.service';
import { EvidenceService } from '../../services/evidence.service';
import { PolicyChainService } from '../../services/policy-chain.service';
import { ProductService } from '../../services/product.service';
import { Web3Service } from '../../services/web3.service';
import { FlowError, describeChainError } from '../../utils/chain-errors';
import { errorMessage } from '../../utils/api-helpers';
import { explorerTxUrl, formatEth, perilIcon, perilLabel, thresholdText } from '../../utils/format';

type PhotoKind = 'selfie' | 'field' | 'document';
type Phase = 'idle' | 'running';
type StageState = 'todo' | 'doing' | 'done' | 'error';
type Stage = 'buy' | 'upload' | 'chain';

const MAX_GPS_ACCURACY_M = 200;
const MAX_PHOTO_BYTES = 10_000_000;
const GAS_RESERVE = parseEther('0.01'); // dự phòng phí gas khi mua
const VN_BOX = { minLat: 8.18, maxLat: 23.4, minLng: 102.14, maxLng: 109.47 }; // khớp PolicyManager.sol

const PHOTO_LABELS: Record<PhotoKind, string> = {
  selfie: 'chân dung',
  field: 'ruộng',
  document: 'giấy tờ đất',
};

interface DoneInfo {
  policyId: number;
  buyTx: string | null;
  evidenceTx: string | null;
  alreadySubmitted: boolean;
}

/**
 * Mua bảo hiểm 4 bước (SPEC-B mục 9.3.2): Chọn gói → Vị trí → 3 ảnh → Thanh toán & gửi.
 * Mua → upload ảnh → so hash server với hash cục bộ → ghi hash lên chain. Policy đã mua mà chưa gửi xong
 * được lưu ở localStorage (wi_pending_{ví}) và tiếp tục qua ?resume={policyId}.
 */
@Component({
  selector: 'app-buy-policy',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './buy-policy.html',
  styleUrl: './buy-policy.css',
})
export class BuyPolicy implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly products = inject(ProductService);
  private readonly contract = inject(ContractService);
  private readonly chain = inject(PolicyChainService);
  private readonly evidence = inject(EvidenceService);
  private readonly web3 = inject(Web3Service);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly stepNames = ['Chọn gói', 'Vị trí', 'Ảnh xác minh', 'Thanh toán'];
  readonly kinds: PhotoKind[] = ['selfie', 'field', 'document'];
  readonly photoLabels = PHOTO_LABELS;
  readonly maxAccuracy = MAX_GPS_ACCURACY_M;

  // Bước hiện tại (1–4) và chế độ tiếp tục gửi hồ sơ
  readonly step = signal(1);
  readonly resumeId = signal<number | null>(null);
  readonly resumeLoading = signal(false);
  readonly resumeError = signal<string | null>(null);
  readonly pendingBanner = signal<number | null>(null);

  // Bước 1
  readonly productList = signal<ProductDto[]>([]);
  readonly productsLoading = signal(true);
  readonly productsError = signal<string | null>(null);
  readonly selectedId = signal<number | null>(null);
  readonly selected = computed(() => this.productList().find((p) => p.productId === this.selectedId()) ?? null);

  // Bước 2
  readonly lat = signal<number | null>(null);
  readonly lng = signal<number | null>(null);
  readonly accuracy = signal<number | null>(null);
  readonly gpsLoading = signal(false);
  readonly gpsError = signal<string | null>(null);
  /** true khi toạ độ lấy từ policy on-chain (chế độ tiếp tục gửi hồ sơ), không lấy GPS lại. */
  readonly positionFromPolicy = signal(false);
  readonly resumeProductName = signal<string | null>(null);

  // Bước 3
  readonly photos = signal<Record<PhotoKind, File | null>>({ selfie: null, field: null, document: null });
  readonly previews = signal<Record<PhotoKind, string | null>>({ selfie: null, field: null, document: null });
  readonly photoErrors = signal<Record<PhotoKind, string | null>>({ selfie: null, field: null, document: null });
  readonly stepError = signal<string | null>(null);

  // Bước 4
  readonly phase = signal<Phase>('idle');
  readonly stages = signal<Record<Stage, StageState>>({ buy: 'todo', upload: 'todo', chain: 'todo' });
  readonly submitError = signal<string | null>(null);
  readonly done = signal<DoneInfo | null>(null);
  readonly balance = this.web3.balance;

  /** Policy đã mua nhưng chưa gửi xong hồ sơ trong phiên này (cho phép bấm gửi lại không mua lần hai). */
  private pendingPolicyId: number | null = null;
  private buyTx: string | null = null;

  readonly canGoBack = computed(() => {
    const min = this.resumeId() !== null ? 3 : 1;
    return this.step() > min && this.phase() === 'idle';
  });

  readonly photosReady = computed(() => this.kinds.every((k) => this.photos()[k] !== null));
  readonly summaryPremium = computed(() => (this.selected() ? formatEth(this.selected()!.premiumWei) : null));

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const raw = params.get('resume');
      void this.init(raw);
    });
  }

  ngOnDestroy(): void {
    this.revokePreviews();
  }

  // ===== Khởi tạo =====

  private async init(resumeParam: string | null): Promise<void> {
    await this.web3.ready;

    if (resumeParam !== null) {
      const id = Number(resumeParam);
      if (!Number.isInteger(id) || id <= 0) {
        this.resumeError.set('Mã policy trong đường dẫn không hợp lệ');
        this.resumeId.set(id > 0 ? id : null);
        this.productsLoading.set(false);
        return;
      }
      await this.startResume(id);
      return;
    }

    // Mua mới
    this.resumeId.set(null);
    this.resumeError.set(null);
    this.positionFromPolicy.set(false);
    if (this.step() > 2 && this.pendingPolicyId === null) this.step.set(1);
    this.pendingBanner.set(this.readPending());
    await this.loadProducts();
  }

  async loadProducts(): Promise<void> {
    this.productsLoading.set(true);
    this.productsError.set(null);
    try {
      const list = (await this.products.list()).filter((p) => p.active);
      this.productList.set(list);
      if (this.selectedId() !== null && !list.some((p) => p.productId === this.selectedId())) {
        this.selectedId.set(null);
      }
    } catch (e) {
      this.productsError.set(errorMessage(e, 'Không tải được danh sách gói bảo hiểm'));
    } finally {
      this.productsLoading.set(false);
    }
  }

  /** Vào chế độ gửi hồ sơ cho policy đã mua: chỉ khi policy của ví này, đang chờ xác minh, chưa có evidence on-chain. */
  private async startResume(id: number): Promise<void> {
    this.resumeId.set(id);
    this.resumeError.set(null);
    this.resumeLoading.set(true);
    this.done.set(null);
    try {
      const policy = await this.chain.getPolicy(id);
      const address = this.web3.address()?.toLowerCase();
      if (!policy) throw new FlowError('Không tìm thấy policy này');
      if (policy.holder !== address) throw new FlowError('Policy này không thuộc ví của bạn');
      if (policy.status !== 0) throw new FlowError('Policy không còn ở trạng thái chờ xác minh');
      if (await this.chain.hasEvidence(id)) {
        this.clearPending(id);
        throw new FlowError('Hồ sơ của policy này đã được gửi lên blockchain, không cần gửi lại');
      }

      this.pendingPolicyId = id;
      this.lat.set(policy.latE6 / 1e6);
      this.lng.set(policy.lngE6 / 1e6);
      this.accuracy.set(0);
      this.positionFromPolicy.set(true);
      this.setStages({ buy: 'done', upload: 'todo', chain: 'todo' });

      this.products
        .list()
        .then((list) => this.resumeProductName.set(list.find((p) => p.productId === policy.productId)?.name ?? null))
        .catch(() => undefined);

      this.step.set(3);
    } catch (e) {
      this.resumeError.set(e instanceof FlowError ? e.message : describeChainError(e, 'Không đọc được policy từ blockchain'));
    } finally {
      this.resumeLoading.set(false);
      this.productsLoading.set(false);
    }
  }

  openResume(id: number): void {
    void this.router.navigate(['/buy-policy'], { queryParams: { resume: id } });
  }

  // ===== Bước 1: chọn gói =====

  selectProduct(p: ProductDto): void {
    this.selectedId.set(p.productId);
    this.stepError.set(null);
  }

  perilIcon = perilIcon;
  perilLabel = perilLabel;
  formatEth = formatEth;

  thresholdOf(p: ProductDto): string {
    return p.thresholdDisplay || thresholdText(p.perilType, p.threshold);
  }

  // ===== Bước 2: vị trí =====

  getGps(): void {
    if (!this.isBrowser || !navigator.geolocation) {
      this.gpsError.set('Trình duyệt không hỗ trợ GPS');
      return;
    }

    this.gpsLoading.set(true);
    this.gpsError.set(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.lat.set(pos.coords.latitude);
        this.lng.set(pos.coords.longitude);
        this.accuracy.set(pos.coords.accuracy);
        this.gpsLoading.set(false);
      },
      (err) => {
        this.gpsError.set(
          err.code === err.PERMISSION_DENIED
            ? 'Bạn chưa cho phép truy cập vị trí. Hãy bật quyền vị trí cho trang này rồi thử lại'
            : 'Không lấy được vị trí: ' + err.message,
        );
        this.gpsLoading.set(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  private validatePosition(): string | null {
    const lat = this.lat();
    const lng = this.lng();
    const accuracy = this.accuracy();
    if (lat === null || lng === null || accuracy === null) return 'Vui lòng lấy vị trí GPS trước';
    if (lat < VN_BOX.minLat || lat > VN_BOX.maxLat || lng < VN_BOX.minLng || lng > VN_BOX.maxLng) {
      return 'Vị trí nằm ngoài phạm vi hỗ trợ (lãnh thổ Việt Nam)';
    }
    if (accuracy > MAX_GPS_ACCURACY_M) {
      return `GPS chưa đủ chính xác (±${accuracy.toFixed(0)} m, cần ≤ ${MAX_GPS_ACCURACY_M} m). Hãy ra chỗ thoáng và lấy lại vị trí`;
    }
    return null;
  }

  // ===== Bước 3: ảnh =====

  onPhoto(kind: PhotoKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.setPhotoError(kind, null);
    this.stepError.set(null);
    if (!file) return;

    const isHeic = /\.(heic|heif)$/i.test(file.name);
    if (!file.type.startsWith('image/') && !isHeic) {
      this.setPhotoError(kind, 'File không phải ảnh');
      input.value = '';
      return;
    }
    if (file.size === 0 || file.size > MAX_PHOTO_BYTES) {
      this.setPhotoError(kind, file.size === 0 ? 'File rỗng' : 'Ảnh vượt quá 10 MB');
      input.value = '';
      return;
    }

    const old = this.previews()[kind];
    if (old) URL.revokeObjectURL(old);
    this.photos.update((p) => ({ ...p, [kind]: file }));
    this.previews.update((p) => ({ ...p, [kind]: URL.createObjectURL(file) }));
  }

  private setPhotoError(kind: PhotoKind, message: string | null): void {
    this.photoErrors.update((e) => ({ ...e, [kind]: message }));
  }

  private revokePreviews(): void {
    if (!this.isBrowser) return;
    for (const url of Object.values(this.previews())) {
      if (url) URL.revokeObjectURL(url);
    }
  }

  // ===== Điều hướng bước =====

  next(): void {
    this.stepError.set(null);
    switch (this.step()) {
      case 1:
        if (!this.selected()) {
          this.stepError.set('Vui lòng chọn một gói bảo hiểm');
          return;
        }
        break;
      case 2: {
        const err = this.validatePosition();
        if (err) {
          this.stepError.set(err);
          return;
        }
        break;
      }
      case 3:
        if (!this.photosReady()) {
          this.stepError.set('Cần đủ 3 ảnh: chân dung, ruộng, giấy tờ đất');
          return;
        }
        break;
    }
    this.step.update((s) => Math.min(4, s + 1));
  }

  back(): void {
    if (!this.canGoBack()) return;
    this.stepError.set(null);
    this.submitError.set(null);
    this.step.update((s) => s - 1);
  }

  // ===== Bước 4: thanh toán và gửi =====

  /** Đã mua nhưng đang kẹt giữa chừng (lần bấm sau chỉ gửi lại hồ sơ). */
  get isRetry(): boolean {
    return this.pendingPolicyId !== null && this.resumeId() === null;
  }

  async submit(): Promise<void> {
    if (this.phase() !== 'idle') return;
    this.submitError.set(null);

    await this.web3.ready;
    const address = this.web3.address();
    if (!address) {
      this.submitError.set('Ví chưa sẵn sàng, thử tải lại trang');
      return;
    }

    const files = this.photos();
    if (!files.selfie || !files.field || !files.document) {
      this.submitError.set('Cần đủ 3 ảnh: chân dung, ruộng, giấy tờ đất');
      return;
    }
    const positionError = this.positionFromPolicy() ? null : this.validatePosition();
    if (positionError) {
      this.submitError.set(positionError);
      return;
    }
    const product = this.selected();
    if (this.pendingPolicyId === null && !product) {
      this.submitError.set('Chưa chọn gói bảo hiểm');
      return;
    }

    this.phase.set('running');
    let stage: Stage = 'buy';
    try {
      // 1. Mua (bỏ qua nếu đã có policy đang chờ gửi hồ sơ)
      if (this.pendingPolicyId === null) {
        const premium = BigInt(product!.premiumWei);
        await this.ensureBalance(premium, address);

        this.setStage('buy', 'doing');
        const receipt = await this.contract.buyPolicy(
          product!.productId,
          BigInt(Math.round(this.lat()! * 1_000_000)),
          BigInt(Math.round(this.lng()! * 1_000_000)),
          formatEther(premium),
        );
        const policyId = this.chain.parsePolicyCreated(receipt);
        if (policyId === null) {
          throw new FlowError(
            'Giao dịch mua đã gửi nhưng không đọc được mã policy. Hãy mở trang Tổng quan để kiểm tra và gửi hồ sơ',
          );
        }
        this.pendingPolicyId = Number(policyId);
        this.buyTx = receipt?.hash ?? null;
        this.savePending(this.pendingPolicyId);
      }
      this.setStage('buy', 'done');
      const policyId = this.pendingPolicyId;

      // 2. Upload ảnh, so hash server với hash tính cục bộ
      stage = 'upload';
      this.setStage('upload', 'doing');
      const [fieldHash, docHash] = await Promise.all([this.evidence.sha256(files.field), this.evidence.sha256(files.document)]);

      let alreadySubmitted = false;
      try {
        const res = await this.evidence.upload(
          BigInt(policyId),
          { selfie: files.selfie, field: files.field, document: files.document },
          { lat: this.lat()!, lng: this.lng()!, accuracy: this.accuracy()! },
          address,
        );
        if (res.fieldPhotoHash.toLowerCase() !== fieldHash || res.documentHash.toLowerCase() !== docHash) {
          throw new FlowError(
            'Hash máy chủ tính ra khác với ảnh trên máy bạn (ảnh có thể bị lỗi khi tải lên). Hãy chọn lại ảnh và gửi lại',
          );
        }
      } catch (e) {
        // Hồ sơ đã nằm trên blockchain từ lần trước: không gửi lại được nữa, coi như hoàn tất.
        if (e instanceof ApiError && e.status === 409 && (await this.chain.hasEvidence(policyId))) {
          alreadySubmitted = true;
        } else {
          throw e;
        }
      }
      this.setStage('upload', 'done');

      // 3. Ghi hash lên blockchain
      let evidenceTx: string | null = null;
      stage = 'chain';
      if (!alreadySubmitted) {
        this.setStage('chain', 'doing');
        try {
          const receipt = await this.contract.submitVerificationEvidence(BigInt(policyId), fieldHash, docHash);
          evidenceTx = receipt?.hash ?? null;
        } catch (e) {
          if (!(await this.chain.hasEvidence(policyId))) throw e;
          alreadySubmitted = true; // giao dịch trước đó đã thành công
        }
      }
      this.setStage('chain', 'done');

      this.done.set({ policyId, buyTx: this.buyTx, evidenceTx, alreadySubmitted });
      this.clearPending(policyId);
      this.pendingPolicyId = null;
      this.buyTx = null;
      void this.web3.refreshBalance();
    } catch (e) {
      this.setStage(stage, 'error');
      const base = e instanceof FlowError ? e.message : e instanceof ApiError ? e.message : describeChainError(e);
      this.submitError.set(
        this.pendingPolicyId !== null && stage !== 'buy'
          ? `Đã mua policy #${this.pendingPolicyId} nhưng chưa gửi xong hồ sơ: ${base}. Bấm "Thử gửi lại" (không bị mua lần hai).`
          : base,
      );
    } finally {
      this.phase.set('idle');
    }
  }

  /** Đủ ETH cho phí bảo hiểm + gas; thiếu thì xin faucet rồi kiểm tra lại. */
  private async ensureBalance(premium: bigint, address: string): Promise<void> {
    const need = premium + GAS_RESERVE;
    const provider = this.web3.getProvider();
    let balance = await provider.getBalance(address);
    if (balance >= need) return;

    let faucetNote = '';
    try {
      await this.web3.ensureGas();
    } catch (e) {
      faucetNote = e instanceof Error ? ` ${e.message}.` : '';
    }
    balance = await provider.getBalance(address);
    if (balance < need) {
      throw new FlowError(
        `Số dư ví không đủ: cần khoảng ${formatEth(need)} ETH (phí bảo hiểm + gas), hiện có ${formatEth(balance)} ETH.${faucetNote}`,
      );
    }
  }

  private setStage(stage: Stage, state: StageState): void {
    this.stages.update((s) => ({ ...s, [stage]: state }));
  }

  private setStages(value: Record<Stage, StageState>): void {
    this.stages.set(value);
  }

  txUrl(hash: string | null): string | null {
    return explorerTxUrl(hash);
  }

  // ===== Lưu policy đang dở trong localStorage =====

  private pendingKey(): string | null {
    const wallet = this.web3.address();
    return wallet ? `wi_pending_${wallet.toLowerCase()}` : null;
  }

  private savePending(policyId: number): void {
    const key = this.pendingKey();
    if (!this.isBrowser || !key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ policyId, step: 'evidence' }));
    } catch {
      // storage đầy hoặc bị chặn: bỏ qua
    }
  }

  private readPending(): number | null {
    const key = this.pendingKey();
    if (!this.isBrowser || !key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const id = Number((JSON.parse(raw) as { policyId?: unknown }).policyId);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }

  private clearPending(policyId: number): void {
    const key = this.pendingKey();
    if (!this.isBrowser || !key) return;
    try {
      const current = this.readPending();
      if (current === null || current === policyId) localStorage.removeItem(key);
    } catch {
      // bỏ qua
    }
    if (this.pendingBanner() === policyId) this.pendingBanner.set(null);
  }
}
