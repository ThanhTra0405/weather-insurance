import { Component, OnInit, inject, signal } from '@angular/core';
import { PageStateComponent } from '../../components/page-state/page-state';
import { SupportNavComponent } from '../../components/support-nav/support-nav';
import { CannedReply } from '../../models/ticket.models';
import { ApiError } from '../../services/api.service';
import { StaffTicketService } from '../../services/staff-ticket.service';
import { ToastService } from '../../services/toast.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatVnDate } from '../../utils/format';

const TITLE_MIN = 2;
const TITLE_MAX = 100;
const BODY_MAX = 2000;

/** /support/canned: thêm, sửa, xoá mẫu trả lời (SPEC-B mục 9.4.5). Sửa/xoá: người tạo hoặc admin (server kiểm, cờ canEdit). */
@Component({
  selector: 'app-support-canned',
  standalone: true,
  imports: [SupportNavComponent, PageStateComponent],
  template: `
    <div class="container page">
      <div class="page-head">
        <div>
          <h1>Mẫu trả lời</h1>
          <p class="page-sub">Dùng <code>{{ '{farmer_name}' }}</code> và <code>{{ '{policy_id}' }}</code> để tự điền tên nông dân và mã policy khi chèn vào ticket.</p>
        </div>
        <button type="button" class="btn btn-primary" (click)="openCreate()">+ Thêm mẫu</button>
      </div>
      <app-support-nav />

      <app-page-state [loading]="loading() && items().length === 0" [error]="error()"
        [empty]="!loading() && !error() && items().length === 0" emptyText="Chưa có mẫu trả lời nào." (retry)="load()" />

      <div class="list">
        @for (c of items(); track c.id) {
          <article class="card item">
            <div class="top">
              <h2>{{ c.title }}</h2>
              @if (c.canEdit) {
                <div class="actions">
                  <button type="button" class="btn btn-outline btn-sm" (click)="openEdit(c)">Sửa</button>
                  <button type="button" class="btn btn-outline btn-sm danger" (click)="askDelete(c)">Xoá</button>
                </div>
              }
            </div>
            <p class="body">{{ c.body }}</p>
            <p class="meta">{{ c.createdByName ?? 'Không rõ' }} · {{ date(c.createdAt) }}</p>
          </article>
        }
      </div>
    </div>

    @if (form(); as f) {
      <div class="overlay" (click)="closeForm()">
        <form class="dialog card" role="dialog" aria-modal="true" aria-labelledby="cf-title" (click)="$event.stopPropagation()" (submit)="onSave($event)">
          <h2 id="cf-title">{{ f.id ? 'Sửa mẫu trả lời' : 'Thêm mẫu trả lời' }}</h2>
          <div class="field">
            <label for="cf-t">Tiêu đề</label>
            <input id="cf-t" type="text" maxlength="100" [value]="f.title" [disabled]="saving()" [attr.aria-invalid]="!!fieldErrors().title"
              (input)="setField('title', $any($event.target).value)" />
            @if (fieldErrors().title; as e) { <p class="field-error">{{ e }}</p> }
          </div>
          <div class="field">
            <label for="cf-b">Nội dung</label>
            <textarea id="cf-b" rows="6" maxlength="2000" [value]="f.body" [disabled]="saving()" [attr.aria-invalid]="!!fieldErrors().body"
              (input)="setField('body', $any($event.target).value)"></textarea>
            <p class="hint">{{ f.body.length }}/2000</p>
            @if (fieldErrors().body; as e) { <p class="field-error">{{ e }}</p> }
          </div>
          @if (formError(); as fe) { <div class="alert alert-error" role="alert">{{ fe }}</div> }
          <div class="dialog-actions">
            <button type="button" class="btn btn-outline" (click)="closeForm()" [disabled]="saving()">Huỷ</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Đang lưu... } @else { Lưu }
            </button>
          </div>
        </form>
      </div>
    }

    @if (deleting(); as d) {
      <div class="overlay" (click)="deleting.set(null)">
        <div class="dialog card" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()">
          <h2>Xoá mẫu trả lời?</h2>
          <p>Mẫu "<strong>{{ d.title }}</strong>" sẽ bị xoá vĩnh viễn.</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-outline" (click)="deleting.set(null)" [disabled]="saving()">Huỷ</button>
            <button type="button" class="btn btn-danger" (click)="confirmDelete()" [disabled]="saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> } Xoá
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .page { padding-top: 24px; padding-bottom: 48px; max-width: 820px; }
      code { background: var(--color-bg-secondary); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
      .list { display: grid; gap: 10px; }
      .item { padding: 14px 16px; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
      h2 { font-size: 16px; margin: 0; word-break: break-word; }
      .actions { display: flex; gap: 6px; }
      .danger { color: var(--color-error); border-color: var(--color-error); }
      .danger:hover { background: #fef2f2; }
      .body { white-space: pre-wrap; word-break: break-word; font-size: 14px; color: var(--color-text-secondary); margin: 8px 0; }
      .meta { font-size: 12.5px; color: var(--color-text-muted); margin: 0; }
      .hint { font-size: 12.5px; color: var(--color-text-muted); margin: 4px 0 0; text-align: right; }
      textarea { resize: vertical; }
    `,
  ],
})
export class SupportCannedPage implements OnInit {
  private readonly svc = inject(StaffTicketService);
  private readonly toast = inject(ToastService);

  readonly items = signal<CannedReply[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly form = signal<{ id: number | null; title: string; body: string } | null>(null);
  readonly fieldErrors = signal<{ title?: string; body?: string }>({});
  readonly formError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly deleting = signal<CannedReply | null>(null);

  date = formatVnDate;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.svc.cannedList());
    } catch (e) {
      this.error.set(errorMessage(e, 'Không tải được mẫu trả lời'));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.fieldErrors.set({});
    this.formError.set(null);
    this.form.set({ id: null, title: '', body: '' });
  }

  openEdit(c: CannedReply): void {
    this.fieldErrors.set({});
    this.formError.set(null);
    this.form.set({ id: c.id, title: c.title, body: c.body });
  }

  closeForm(): void {
    if (!this.saving()) this.form.set(null);
  }

  setField(key: 'title' | 'body', value: string): void {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
  }

  private validate(title: string, body: string): { title?: string; body?: string } {
    const errors: { title?: string; body?: string } = {};
    if (title.length < TITLE_MIN || title.length > TITLE_MAX) errors.title = `Tiêu đề phải từ ${TITLE_MIN} đến ${TITLE_MAX} ký tự`;
    if (body.length < 1 || body.length > BODY_MAX) errors.body = `Nội dung phải từ 1 đến ${BODY_MAX} ký tự`;
    return errors;
  }

  async onSave(event: Event): Promise<void> {
    event.preventDefault();
    const f = this.form();
    if (!f || this.saving()) return;

    const title = f.title.trim();
    const body = f.body.trim();
    const errors = this.validate(title, body);
    this.fieldErrors.set(errors);
    if (errors.title || errors.body) return;

    this.saving.set(true);
    this.formError.set(null);
    try {
      if (f.id) await this.svc.cannedUpdate(f.id, title, body);
      else await this.svc.cannedCreate(title, body);
      this.toast.success(f.id ? 'Đã cập nhật mẫu trả lời' : 'Đã thêm mẫu trả lời');
      this.form.set(null);
      await this.load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) this.fieldErrors.set(e.fields);
      this.formError.set(errorMessage(e, 'Không lưu được mẫu trả lời'));
    } finally {
      this.saving.set(false);
    }
  }

  askDelete(c: CannedReply): void {
    this.deleting.set(c);
  }

  async confirmDelete(): Promise<void> {
    const c = this.deleting();
    if (!c || this.saving()) return;
    this.saving.set(true);
    try {
      await this.svc.cannedDelete(c.id);
      this.toast.success('Đã xoá mẫu trả lời');
      this.deleting.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e, 'Không xoá được mẫu trả lời'));
      this.deleting.set(null);
    } finally {
      this.saving.set(false);
    }
  }
}
