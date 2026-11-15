import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProfileFormComponent } from '../../components/profile-form/profile-form';
import { ApiError, ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { ProfileDto } from '../../models/auth.models';
import { ProfileFormValue, emptyProfileForm, formFromDto, toProfileInput, validateProfile } from '../../utils/profile-form';

interface TelegramLink {
  code: string;
  deepLink: string;
  expiresAt: string;
}

/** Chỉnh sửa hồ sơ nông dân (SPEC-B mục 9.3.1). Đăng ký ban đầu ở /register. */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ProfileFormComponent],
  template: `
    <div class="container page">
      <h1>Hồ sơ của tôi</h1>

      @if (loading()) {
        <div class="card"><p class="muted"><span class="spinner" aria-hidden="true"></span> Đang tải hồ sơ...</p></div>
      } @else if (loadError(); as le) {
        <div class="card">
          <div class="alert alert-error" role="alert">{{ le }}</div>
          <button type="button" class="btn btn-outline" (click)="load()">Thử lại</button>
        </div>
      } @else {
        @if (needsComplete()) {
          <div class="alert alert-info" role="status">Vui lòng hoàn thiện hồ sơ để mua bảo hiểm và gửi yêu cầu hỗ trợ.</div>
        }
        @if (notice(); as n) { <div class="alert alert-error" role="alert">{{ n }}</div> }

        <form (submit)="onSubmit($event)" novalidate>
          <app-profile-form [(value)]="form" [serverErrors]="serverErrors()" [showAll]="showAllErrors()"
            [disabled]="saving()" [showNotifyEmail]="false" />

          <fieldset class="block" [disabled]="saving()">
            <legend>Thông báo</legend>
            <label class="check">
              <input type="checkbox" [checked]="form().notifyEmail" (change)="setNotifyEmail($event)" />
              <span>Nhận thông báo qua email (cần điền email ở trên)</span>
            </label>

            <label class="check">
              <input type="checkbox" [checked]="notifyTelegram()" [disabled]="!telegramLinked()"
                (change)="notifyTelegram.set($any($event.target).checked)" />
              <span>Nhận thông báo qua Telegram @if (!telegramLinked()) { (cần liên kết trước) }</span>
            </label>

            <div class="tg">
              @if (telegramLinked()) {
                <span class="tg-status ok">✓ Đã liên kết Telegram</span>
              } @else {
                <span class="tg-status">Chưa liên kết Telegram</span>
              }
              <button type="button" class="btn btn-outline small" (click)="createTelegramLink()" [disabled]="tgBusy()">
                {{ tgBusy() ? 'Đang tạo...' : telegramLinked() ? 'Liên kết lại' : 'Liên kết Telegram' }}
              </button>
            </div>

            @if (tgError(); as te) { <p class="field-error">{{ te }}</p> }
            @if (tgLink(); as link) {
              <div class="tg-link">
                <p>Bấm nút dưới đây để mở Telegram và gửi lệnh <span class="mono">/start</span>. Mã có hiệu lực 15 phút.</p>
                <a class="btn btn-primary small" [href]="link.deepLink" target="_blank" rel="noopener noreferrer">Mở Telegram</a>
                <button type="button" class="btn btn-outline small" (click)="refreshAfterLink()" [disabled]="tgBusy()">
                  Tôi đã liên kết xong
                </button>
                <p class="mono code">Mã: {{ link.code }}</p>
              </div>
            }
          </fieldset>

          <div class="actions">
            <button type="submit" class="btn btn-primary" [disabled]="saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Đang lưu... } @else { Lưu hồ sơ }
            </button>
          </div>
        </form>
      }
    </div>
  `,
  styles: [
    `
      .page { max-width: 720px; padding-top: 24px; padding-bottom: 48px; }
      h1 { font-size: 24px; margin: 0 0 16px; }
      .muted { margin: 0; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
      fieldset.block { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 14px 16px 12px; margin: 0 0 16px; min-width: 0; }
      legend { font-weight: 700; font-size: 14px; padding: 0 6px; color: var(--color-primary-dark); }
      .check { display: flex; align-items: center; gap: 8px; font-weight: 500; margin: 0 0 10px; }
      .check input { width: auto; }
      .tg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
      .tg-status { font-size: 14px; color: var(--color-text-secondary); }
      .tg-status.ok { color: var(--color-primary-dark); font-weight: 600; }
      .small { padding: 8px 14px; font-size: 14px; }
      .tg-link { margin-top: 12px; padding: 12px; background: var(--color-bg-secondary); border-radius: var(--radius-sm); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .tg-link p { flex-basis: 100%; margin: 0; font-size: 14px; color: var(--color-text-secondary); }
      .tg-link p.code { font-size: 13px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .actions { display: flex; justify-content: flex-end; }
    `,
  ],
})
export class ProfilePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  form = signal<ProfileFormValue>(emptyProfileForm());
  readonly notifyTelegram = signal(false);
  readonly telegramLinked = signal(false);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly notice = signal<string | null>(null);
  readonly showAllErrors = signal(false);
  readonly serverErrors = signal<Record<string, string> | null>(null);
  readonly needsComplete = signal(false);

  readonly tgBusy = signal(false);
  readonly tgError = signal<string | null>(null);
  readonly tgLink = signal<TelegramLink | null>(null);

  private returnUrl: string | null = null;

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const dto = await this.auth.loadProfile(true);
      if (dto) this.applyDto(dto);
      this.needsComplete.set(!dto?.isComplete);
    } catch (e) {
      this.loadError.set(e instanceof ApiError ? e.message : 'Không tải được hồ sơ');
    } finally {
      this.loading.set(false);
    }
  }

  private applyDto(dto: ProfileDto): void {
    this.form.set(formFromDto(dto));
    this.telegramLinked.set(dto.telegramLinked);
    this.notifyTelegram.set(dto.telegramLinked && dto.notifyTelegram);
  }

  setNotifyEmail(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.update((v) => ({ ...v, notifyEmail: checked }));
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    void this.save();
  }

  private async save(): Promise<void> {
    if (this.saving()) return;
    this.notice.set(null);
    this.showAllErrors.set(true);

    if (Object.keys(validateProfile(this.form())).length > 0) {
      this.notice.set('Vui lòng điền đúng các ô được đánh dấu.');
      return;
    }

    this.saving.set(true);
    this.serverErrors.set(null);
    try {
      const dto = await this.api.put<ProfileDto>(
        '/api/profile/me',
        toProfileInput(this.form(), { notifyTelegram: this.telegramLinked() && this.notifyTelegram() }),
      );
      this.auth.setProfile(dto);
      this.applyDto(dto);
      this.showAllErrors.set(false);
      this.needsComplete.set(!dto.isComplete);
      this.toast.success('Đã lưu hồ sơ');

      if (this.returnUrl && dto.isComplete) {
        await this.router.navigateByUrl(this.auth.safeReturnUrl(this.returnUrl));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.fields) {
        this.serverErrors.set(e.fields);
        this.notice.set('Máy chủ báo một số thông tin chưa hợp lệ, vui lòng sửa các ô được đánh dấu.');
      } else if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
        this.notice.set('Không kết nối được máy chủ, hãy thử lại.');
      } else {
        this.notice.set(e instanceof ApiError ? e.message : 'Không lưu được hồ sơ');
      }
    } finally {
      this.saving.set(false);
    }
  }

  async createTelegramLink(): Promise<void> {
    this.tgBusy.set(true);
    this.tgError.set(null);
    try {
      this.tgLink.set(await this.api.post<TelegramLink>('/api/profile/telegram-link'));
    } catch (e) {
      this.tgLink.set(null);
      this.tgError.set(e instanceof ApiError ? e.message : 'Không tạo được liên kết Telegram');
    } finally {
      this.tgBusy.set(false);
    }
  }

  /** Sau khi người dùng bấm /start trong Telegram: tải lại hồ sơ để cập nhật trạng thái liên kết. */
  async refreshAfterLink(): Promise<void> {
    this.tgBusy.set(true);
    try {
      const dto = await this.auth.loadProfile(true);
      if (dto) {
        this.telegramLinked.set(dto.telegramLinked);
        this.notifyTelegram.set(dto.telegramLinked && dto.notifyTelegram);
        if (dto.telegramLinked) {
          this.tgLink.set(null);
          this.toast.success('Đã liên kết Telegram');
        } else {
          this.toast.info('Chưa thấy liên kết, hãy bấm Start trong Telegram rồi thử lại');
        }
      }
    } catch {
      this.toast.error('Không kiểm tra được trạng thái liên kết');
    } finally {
      this.tgBusy.set(false);
    }
  }
}
