import { Component, PLATFORM_ID, computed, effect, inject, input, model, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  ProfileErrors,
  ProfileFormValue,
  validateProfile,
  MAX_LAT,
  MAX_LNG,
  MIN_LAT,
  MIN_LNG,
} from '../../utils/profile-form';

type TextField = Exclude<keyof ProfileFormValue, 'notifyEmail'>;

/**
 * Các ô hồ sơ nông dân, dùng chung cho bước 3 của /register và trang /profile.
 * Validate tại chỗ theo đúng quy tắc server; lỗi từ server (fields) hiện đè cho tới khi người dùng sửa ô đó.
 */
@Component({
  selector: 'app-profile-form',
  standalone: true,
  template: `
    <fieldset class="block" [disabled]="disabled()">
      <legend>Thông tin cá nhân</legend>

      <div class="field">
        <label for="pf-fullName">Họ và tên <span class="req" aria-hidden="true">*</span></label>
        <input id="pf-fullName" type="text" autocomplete="name" [value]="value().fullName"
          [attr.aria-invalid]="!!err('fullName')" [attr.aria-describedby]="err('fullName') ? 'pf-fullName-err' : null"
          (input)="setText('fullName', $event)" (blur)="touch('fullName')" />
        @if (err('fullName'); as m) { <p class="field-error" id="pf-fullName-err">{{ m }}</p> }
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="pf-phone">Số điện thoại <span class="req" aria-hidden="true">*</span></label>
          <input id="pf-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="09xxxxxxxx hoặc +84xxxxxxxxx"
            [value]="value().phone" [attr.aria-invalid]="!!err('phone')"
            [attr.aria-describedby]="err('phone') ? 'pf-phone-err' : null"
            (input)="setText('phone', $event)" (blur)="touch('phone')" />
          @if (err('phone'); as m) { <p class="field-error" id="pf-phone-err">{{ m }}</p> }
        </div>
        <div class="field">
          <label for="pf-email">Email (tuỳ chọn)</label>
          <input id="pf-email" type="email" autocomplete="email" [value]="value().email"
            [attr.aria-invalid]="!!err('email')" [attr.aria-describedby]="err('email') ? 'pf-email-err' : null"
            (input)="setText('email', $event)" (blur)="touch('email')" />
          @if (err('email'); as m) { <p class="field-error" id="pf-email-err">{{ m }}</p> }
        </div>
      </div>
    </fieldset>

    <fieldset class="block" [disabled]="disabled()">
      <legend>Vị trí &amp; cây trồng</legend>

      <div class="grid-2">
        <div class="field">
          <label for="pf-province">Tỉnh / thành phố <span class="req" aria-hidden="true">*</span></label>
          <input id="pf-province" type="text" autocomplete="address-level1" [value]="value().province"
            [attr.aria-invalid]="!!err('province')" [attr.aria-describedby]="err('province') ? 'pf-province-err' : null"
            (input)="setText('province', $event)" (blur)="touch('province')" />
          @if (err('province'); as m) { <p class="field-error" id="pf-province-err">{{ m }}</p> }
        </div>
        <div class="field">
          <label for="pf-district">Quận / huyện <span class="req" aria-hidden="true">*</span></label>
          <input id="pf-district" type="text" autocomplete="address-level2" [value]="value().district"
            [attr.aria-invalid]="!!err('district')" [attr.aria-describedby]="err('district') ? 'pf-district-err' : null"
            (input)="setText('district', $event)" (blur)="touch('district')" />
          @if (err('district'); as m) { <p class="field-error" id="pf-district-err">{{ m }}</p> }
        </div>
      </div>

      <div class="field">
        <label for="pf-commune">Phường / xã (tuỳ chọn)</label>
        <input id="pf-commune" type="text" autocomplete="address-level3" [value]="value().commune"
          [attr.aria-invalid]="!!err('commune')" [attr.aria-describedby]="err('commune') ? 'pf-commune-err' : null"
          (input)="setText('commune', $event)" (blur)="touch('commune')" />
        @if (err('commune'); as m) { <p class="field-error" id="pf-commune-err">{{ m }}</p> }
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="pf-cropType">Loại cây trồng <span class="req" aria-hidden="true">*</span></label>
          <input id="pf-cropType" type="text" placeholder="Ví dụ: lúa, cà phê, thanh long" [value]="value().cropType"
            [attr.aria-invalid]="!!err('cropType')" [attr.aria-describedby]="err('cropType') ? 'pf-cropType-err' : null"
            (input)="setText('cropType', $event)" (blur)="touch('cropType')" />
          @if (err('cropType'); as m) { <p class="field-error" id="pf-cropType-err">{{ m }}</p> }
        </div>
        <div class="field">
          <label for="pf-farmAreaHa">Diện tích (ha) <span class="req" aria-hidden="true">*</span></label>
          <input id="pf-farmAreaHa" type="text" inputmode="decimal" placeholder="Ví dụ: 1,5" [value]="value().farmAreaHa"
            [attr.aria-invalid]="!!err('farmAreaHa')" [attr.aria-describedby]="err('farmAreaHa') ? 'pf-farmAreaHa-err' : null"
            (input)="setText('farmAreaHa', $event)" (blur)="touch('farmAreaHa')" />
          @if (err('farmAreaHa'); as m) { <p class="field-error" id="pf-farmAreaHa-err">{{ m }}</p> }
        </div>
      </div>

      <div class="gps-row">
        <button type="button" class="btn btn-outline" (click)="useGps()" [disabled]="gpsBusy() || disabled()">
          @if (gpsBusy()) { <span class="spinner" aria-hidden="true"></span> Đang lấy vị trí... }
          @else { 📍 Lấy vị trí ruộng bằng GPS }
        </button>
        @if (gpsMessage(); as m) { <span class="gps-msg" [class.bad]="gpsFailed()">{{ m }}</span> }
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="pf-farmLat">Vĩ độ ruộng (tuỳ chọn)</label>
          <input id="pf-farmLat" type="text" inputmode="decimal" [placeholder]="latHint" [value]="value().farmLat"
            [attr.aria-invalid]="!!err('farmLat')" [attr.aria-describedby]="err('farmLat') ? 'pf-farmLat-err' : null"
            (input)="setText('farmLat', $event)" (blur)="touch('farmLat')" />
          @if (err('farmLat'); as m) { <p class="field-error" id="pf-farmLat-err">{{ m }}</p> }
        </div>
        <div class="field">
          <label for="pf-farmLng">Kinh độ ruộng (tuỳ chọn)</label>
          <input id="pf-farmLng" type="text" inputmode="decimal" [placeholder]="lngHint" [value]="value().farmLng"
            [attr.aria-invalid]="!!err('farmLng')" [attr.aria-describedby]="err('farmLng') ? 'pf-farmLng-err' : null"
            (input)="setText('farmLng', $event)" (blur)="touch('farmLng')" />
          @if (err('farmLng'); as m) { <p class="field-error" id="pf-farmLng-err">{{ m }}</p> }
        </div>
      </div>
    </fieldset>

    @if (showNotifyEmail()) {
      <fieldset class="block" [disabled]="disabled()">
        <legend>Thông báo</legend>
        <label class="check">
          <input type="checkbox" [checked]="value().notifyEmail" (change)="setNotifyEmail($event)" />
          <span>Nhận thông báo qua email (cần điền email ở trên)</span>
        </label>
      </fieldset>
    }
  `,
  styles: [
    `
      :host { display: block; }
      fieldset.block {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 14px 16px 6px;
        margin: 0 0 16px;
        min-width: 0;
      }
      legend { font-weight: 700; font-size: 14px; padding: 0 6px; color: var(--color-primary-dark); }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
      .field { margin-bottom: 12px; min-width: 0; }
      .req { color: var(--color-error); }
      .gps-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
      .gps-msg { font-size: 13px; color: var(--color-text-secondary); }
      .gps-msg.bad { color: var(--color-error); }
      .check { display: flex; align-items: center; gap: 8px; font-weight: 500; margin-bottom: 10px; }
      .check input { width: auto; }
      @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
    `,
  ],
})
export class ProfileFormComponent {
  /** Giá trị form (two-way: [(value)]). */
  readonly value = model.required<ProfileFormValue>();
  /** Lỗi do server trả về (fields). Tự ẩn khi người dùng sửa ô tương ứng. */
  readonly serverErrors = input<Record<string, string> | null>(null);
  /** Hiện mọi lỗi (sau khi bấm gửi) thay vì chỉ ô đã chạm vào. */
  readonly showAll = input(false);
  readonly disabled = input(false);
  readonly showNotifyEmail = input(true);

  readonly latHint = `${MIN_LAT} – ${MAX_LAT}`;
  readonly lngHint = `${MIN_LNG} – ${MAX_LNG}`;

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly touched = signal<ReadonlySet<string>>(new Set());
  private readonly dismissedServer = signal<ReadonlySet<string>>(new Set());

  readonly gpsBusy = signal(false);
  readonly gpsMessage = signal<string | null>(null);
  readonly gpsFailed = signal(false);

  private readonly clientErrors = computed<ProfileErrors>(() => validateProfile(this.value()));

  constructor() {
    // Có đợt lỗi server mới thì cho hiện lại tất cả.
    effect(() => {
      this.serverErrors();
      this.dismissedServer.set(new Set());
    });
  }

  err(field: TextField): string | null {
    const server = this.serverErrors()?.[field];
    if (server && !this.dismissedServer().has(field)) return server;
    const client = this.clientErrors()[field];
    if (client && (this.showAll() || this.touched().has(field))) return client;
    return null;
  }

  touch(field: TextField): void {
    this.touched.update((s) => new Set(s).add(field));
  }

  setText(field: TextField, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.value.update((v) => ({ ...v, [field]: text }));
    this.dismissedServer.update((s) => new Set(s).add(field));
  }

  setNotifyEmail(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.value.update((v) => ({ ...v, notifyEmail: checked }));
  }

  useGps(): void {
    this.gpsMessage.set(null);
    this.gpsFailed.set(false);
    if (!this.isBrowser || !navigator.geolocation) {
      this.gpsFailed.set(true);
      this.gpsMessage.set('Trình duyệt không hỗ trợ GPS, hãy nhập tay.');
      return;
    }
    this.gpsBusy.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.gpsBusy.set(false);
        if (lat < MIN_LAT || lat > MAX_LAT || lng < MIN_LNG || lng > MAX_LNG) {
          this.gpsFailed.set(true);
          this.gpsMessage.set('Vị trí hiện tại nằm ngoài lãnh thổ Việt Nam, hệ thống không nhận.');
          return;
        }
        this.value.update((v) => ({ ...v, farmLat: lat.toFixed(6), farmLng: lng.toFixed(6) }));
        this.dismissedServer.update((s) => new Set(s).add('farmLat').add('farmLng'));
        this.gpsMessage.set(`Đã lấy vị trí (sai số khoảng ${Math.round(pos.coords.accuracy)} m).`);
      },
      (err) => {
        this.gpsBusy.set(false);
        this.gpsFailed.set(true);
        this.gpsMessage.set(
          err.code === err.PERMISSION_DENIED
            ? 'Bạn đã từ chối quyền vị trí. Hãy cho phép trong cài đặt trình duyệt hoặc nhập tay.'
            : 'Không lấy được vị trí, thử lại hoặc nhập tay.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }
}
