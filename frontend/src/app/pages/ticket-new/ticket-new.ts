import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PolicySummary } from '../../models/policy.models';
import { TicketCategory } from '../../models/ticket.models';
import { ApiError } from '../../services/api.service';
import { PolicyService } from '../../services/policy.service';
import { TicketService } from '../../services/ticket.service';
import { ToastService } from '../../services/toast.service';
import { errorMessage } from '../../utils/api-helpers';
import { TICKET_CATEGORIES } from '../../utils/ticket-text';

const SUBJECT_MIN = 5;
const SUBJECT_MAX = 150;
const BODY_MAX = 4000;

/** /tickets/new: tạo yêu cầu hỗ trợ (SPEC-B mục 9.3.5). Policy liên quan điền sẵn từ ?policyId=. */
@Component({
  selector: 'app-ticket-new',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="container page">
      <p class="back"><a routerLink="/tickets">← Hỗ trợ</a></p>
      <h1>Tạo yêu cầu hỗ trợ</h1>

      <form class="card" (submit)="onSubmit($event)" novalidate>
        @if (formError(); as fe) {
          <div class="alert alert-error" role="alert">
            {{ fe }}
            @if (needsProfile()) { <a routerLink="/profile" [queryParams]="{ returnUrl: '/tickets/new' }">Hoàn thiện hồ sơ</a> }
          </div>
        }

        <div class="field">
          <label for="category">Loại yêu cầu</label>
          <select id="category" [value]="category()" (change)="category.set($any($event.target).value)" [attr.aria-invalid]="!!errors()['category']" [disabled]="busy()">
            <option value="">— Chọn loại yêu cầu —</option>
            @for (c of categories; track c.value) { <option [value]="c.value" [selected]="category() === c.value">{{ c.label }}</option> }
          </select>
          @if (errors()['category']; as e) { <p class="field-error">{{ e }}</p> }
        </div>

        <div class="field">
          <label for="policy">Policy liên quan (không bắt buộc)</label>
          <select id="policy" [disabled]="busy()" (change)="onPolicyChange($any($event.target).value)" [attr.aria-invalid]="!!errors()['policyId']">
            <option value="" [selected]="policyId() === null">Không liên quan policy cụ thể</option>
            @for (p of policyOptions(); track p.id) {
              <option [value]="p.id" [selected]="policyId() === p.id">{{ p.label }}</option>
            }
          </select>
          @if (policiesLoading()) { <p class="hint">Đang tải danh sách policy...</p> }
          @if (errors()['policyId']; as e) { <p class="field-error">{{ e }}</p> }
        </div>

        <div class="field">
          <label for="subject">Tiêu đề</label>
          <input id="subject" type="text" maxlength="150" autocomplete="off" [value]="subject()" (input)="subject.set($any($event.target).value)" [attr.aria-invalid]="!!errors()['subject']" [disabled]="busy()" />
          @if (errors()['subject']; as e) { <p class="field-error">{{ e }}</p> }
        </div>

        <div class="field">
          <label for="body">Nội dung</label>
          <textarea id="body" rows="6" maxlength="4000" [value]="body()" (input)="body.set($any($event.target).value)" [attr.aria-invalid]="!!errors()['body']" [disabled]="busy()"></textarea>
          <p class="hint">{{ body().length }}/4000</p>
          @if (errors()['body']; as e) { <p class="field-error">{{ e }}</p> }
        </div>

        <button type="submit" class="btn btn-primary btn-block" [disabled]="busy()">
          @if (busy()) { <span class="spinner" aria-hidden="true"></span> Đang gửi... } @else { Gửi yêu cầu }
        </button>
      </form>
    </div>
  `,
  styles: [
    `
      .page { max-width: 640px; padding-top: 16px; padding-bottom: 48px; }
      .back { margin: 0 0 10px; font-size: 14px; }
      h1 { font-size: 22px; margin: 0 0 14px; }
      .hint { font-size: 12.5px; color: var(--color-text-muted); margin: 4px 0 0; }
      textarea { resize: vertical; min-height: 120px; }
      .alert a { font-weight: 600; text-decoration: underline; margin-left: 6px; }
    `,
  ],
})
export class TicketNewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tickets = inject(TicketService);
  private readonly policyService = inject(PolicyService);
  private readonly toast = inject(ToastService);

  readonly categories = TICKET_CATEGORIES;
  readonly category = signal<TicketCategory | ''>('');
  readonly policyId = signal<number | null>(null);
  readonly subject = signal('');
  readonly body = signal('');

  readonly policyOptions = signal<{ id: number; label: string }[]>([]);
  readonly policiesLoading = signal(true);

  readonly errors = signal<Record<string, string>>({});
  readonly formError = signal<string | null>(null);
  readonly needsProfile = signal(false);
  readonly busy = signal(false);

  ngOnInit(): void {
    const raw = Number(this.route.snapshot.queryParamMap.get('policyId'));
    const preset = Number.isInteger(raw) && raw > 0 ? raw : null;
    if (preset !== null) {
      this.policyId.set(preset);
      this.category.set('policy_info');
    }
    void this.loadPolicies(preset);
  }

  private async loadPolicies(preset: number | null): Promise<void> {
    try {
      const list = await this.policyService.mine();
      const options = list.map((p) => ({ id: p.policyId, label: policyLabel(p) }));
      // policyId trên đường dẫn không nằm trong danh sách: vẫn giữ, server sẽ kiểm chủ policy.
      if (preset !== null && !options.some((o) => o.id === preset)) options.unshift({ id: preset, label: `Policy #${preset}` });
      this.policyOptions.set(options);
    } catch {
      this.policyOptions.set(preset !== null ? [{ id: preset, label: `Policy #${preset}` }] : []);
    } finally {
      this.policiesLoading.set(false);
    }
  }

  onPolicyChange(value: string): void {
    this.policyId.set(value === '' ? null : Number(value));
  }

  private validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!this.category()) errors['category'] = 'Vui lòng chọn loại yêu cầu';
    const subject = this.subject().trim();
    if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) errors['subject'] = `Tiêu đề phải từ ${SUBJECT_MIN} đến ${SUBJECT_MAX} ký tự`;
    const body = this.body().trim();
    if (body.length < 1 || body.length > BODY_MAX) errors['body'] = `Nội dung phải từ 1 đến ${BODY_MAX} ký tự`;
    return errors;
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;

    this.formError.set(null);
    this.needsProfile.set(false);
    const errors = this.validate();
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.busy.set(true);
    try {
      const res = await this.tickets.create({
        policyId: this.policyId(),
        category: this.category() as TicketCategory,
        subject: this.subject().trim(),
        body: this.body().trim(),
      });
      this.toast.success('Đã gửi yêu cầu hỗ trợ');
      await this.router.navigate(['/tickets', res.id]);
    } catch (e) {
      if (e instanceof ApiError && e.fields) this.errors.set({ ...e.fields });
      if (e instanceof ApiError && e.code === 'PROFILE_REQUIRED') this.needsProfile.set(true);
      this.formError.set(errorMessage(e, 'Không gửi được yêu cầu, vui lòng thử lại'));
    } finally {
      this.busy.set(false);
    }
  }
}

function policyLabel(p: PolicySummary): string {
  return `#${p.policyId}${p.productName ? ' · ' + p.productName : ''}`;
}
