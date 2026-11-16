import { Component, ElementRef, OnDestroy, PLATFORM_ID, computed, inject, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TicketStatusChipComponent } from '../../components/ticket-status-chip/ticket-status-chip';
import { TicketDetail } from '../../models/ticket.models';
import { ApiError } from '../../services/api.service';
import { TicketService } from '../../services/ticket.service';
import { ToastService } from '../../services/toast.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatVnDateTime } from '../../utils/format';
import { ticketCategoryLabel } from '../../utils/ticket-text';

const POLL_MS = 10_000;
const BODY_MAX = 4000;
const COMMENT_MAX = 500;

/** /tickets/:id: hội thoại dạng bong bóng, trả lời, đánh giá sao. Polling 10 giây khi tab đang hiển thị. */
@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [RouterLink, TicketStatusChipComponent],
  template: `
    <div class="container page">
      <p class="back"><a routerLink="/tickets">← Hỗ trợ</a></p>

      @if (loading()) {
        <div class="card"><p class="muted"><span class="spinner" aria-hidden="true"></span> Đang tải...</p></div>
      } @else if (notFound()) {
        <div class="card">
          <h1>Không tìm thấy yêu cầu</h1>
          <p class="muted-text">Yêu cầu không tồn tại hoặc không thuộc tài khoản của bạn.</p>
          <a routerLink="/tickets" class="btn btn-primary">Về danh sách</a>
        </div>
      } @else if (loadError(); as le) {
        <div class="card">
          <div class="alert alert-error" role="alert">{{ le }}</div>
          <button type="button" class="btn btn-outline" (click)="load()">Thử lại</button>
        </div>
      } @else if (ticket(); as t) {
        <div class="title-row">
          <h1>{{ t.subject }}</h1>
          <app-ticket-status-chip [status]="t.status" />
        </div>
        <p class="meta">
          #{{ t.id }} · {{ category(t.category) }}
          @if (t.policyId) { · <a [routerLink]="['/policies', t.policyId]">Policy #{{ t.policyId }}</a> }
          · Tạo {{ time(t.createdAt) }}
          @if (t.assignedToName) { · Phụ trách: {{ t.assignedToName }} }
        </p>

        <div class="thread card" #thread aria-live="polite">
          @for (m of t.messages; track m.id) {
            @if (m.senderType === 'system') {
              <div class="sys">{{ m.body }} · {{ time(m.createdAt) }}</div>
            } @else {
              <div class="row" [class.mine]="m.senderType === 'farmer'">
                <div class="bubble" [class.mine]="m.senderType === 'farmer'">
                  <div class="who">{{ m.senderType === 'farmer' ? 'Bạn' : (m.senderName ?? 'Chăm sóc khách hàng') }}</div>
                  <div class="text">{{ m.body }}</div>
                  <div class="time">{{ time(m.createdAt) }}</div>
                </div>
              </div>
            }
          }
        </div>

        @if (t.status === 'closed') {
          <div class="alert alert-info" role="status">
            Yêu cầu này đã đóng. Nếu cần hỗ trợ thêm, vui lòng
            <a routerLink="/tickets/new" [queryParams]="t.policyId ? { policyId: t.policyId } : {}">tạo yêu cầu mới</a>.
          </div>
        } @else {
          <form class="card reply" (submit)="onSend($event)">
            @if (t.status === 'resolved') {
              <p class="hint">Yêu cầu đã được giải quyết. Gửi tin nhắn sẽ mở lại yêu cầu.</p>
            }
            <label for="reply" class="sr-only">Nội dung trả lời</label>
            <textarea id="reply" rows="3" maxlength="4000" placeholder="Nhập nội dung trả lời... (Ctrl+Enter để gửi)"
              [value]="draft()" (input)="draft.set($any($event.target).value)" (keydown.control.enter)="onSend($event)"
              (keydown.meta.enter)="onSend($event)" [disabled]="sending()"></textarea>
            @if (sendError(); as se) { <p class="field-error">{{ se }}</p> }
            <div class="reply-actions">
              <span class="hint">{{ draft().length }}/4000</span>
              <button type="submit" class="btn btn-primary" [disabled]="sending() || draft().trim().length === 0">
                @if (sending()) { <span class="spinner" aria-hidden="true"></span> Đang gửi... } @else { Gửi }
              </button>
            </div>
          </form>
        }

        @if (t.status === 'resolved' || t.status === 'closed') {
          <section class="card rating">
            <h2>Đánh giá hỗ trợ</h2>
            @if (t.rating !== null) {
              <div class="stars readonly" [attr.aria-label]="'Bạn đã đánh giá ' + t.rating + ' sao'">
                @for (n of starValues; track n) { <span [class.on]="n <= t.rating">★</span> }
              </div>
              @if (t.ratingComment) { <p class="muted-text">{{ t.ratingComment }}</p> }
              <p class="hint">Cảm ơn bạn đã đánh giá.</p>
            } @else {
              <div class="stars" role="radiogroup" aria-label="Chọn số sao">
                @for (n of starValues; track n) {
                  <button type="button" role="radio" [attr.aria-checked]="stars() === n" [attr.aria-label]="n + ' sao'"
                    [class.on]="n <= (hoverStars() || stars())" (mouseenter)="hoverStars.set(n)" (mouseleave)="hoverStars.set(0)"
                    (click)="stars.set(n)" [disabled]="rating()">★</button>
                }
              </div>
              <label for="rating-comment" class="sr-only">Nhận xét</label>
              <textarea id="rating-comment" rows="2" maxlength="500" placeholder="Nhận xét (không bắt buộc)" [value]="comment()"
                (input)="comment.set($any($event.target).value)" [disabled]="rating()"></textarea>
              @if (ratingError(); as re) { <p class="field-error">{{ re }}</p> }
              <button type="button" class="btn btn-primary" (click)="onRate()" [disabled]="rating() || stars() === 0">
                @if (rating()) { <span class="spinner" aria-hidden="true"></span> Đang gửi... } @else { Gửi đánh giá }
              </button>
            }
          </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .page { max-width: 760px; padding-top: 16px; padding-bottom: 60px; }
      .back { margin: 0 0 10px; font-size: 14px; }
      h1 { font-size: 21px; margin: 0; word-break: break-word; }
      h2 { font-size: 16px; margin: 0 0 10px; color: var(--color-primary-dark); }
      .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .meta { font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 14px; }
      .muted { margin: 0; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
      .muted-text { color: var(--color-text-secondary); font-size: 14px; margin: 0 0 12px; }
      .hint { font-size: 12.5px; color: var(--color-text-muted); margin: 0; }
      .thread { display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow-y: auto; margin-bottom: 14px; padding: 14px; }
      .row { display: flex; }
      .row.mine { justify-content: flex-end; }
      .bubble { max-width: 82%; background: #f3f4f6; border-radius: 14px 14px 14px 4px; padding: 8px 12px; }
      .bubble.mine { background: var(--color-primary-light); border-radius: 14px 14px 4px 14px; }
      .who { font-size: 12px; font-weight: 700; color: var(--color-text-secondary); margin-bottom: 2px; }
      .text { font-size: 14.5px; white-space: pre-wrap; word-break: break-word; }
      .time { font-size: 11.5px; color: var(--color-text-muted); margin-top: 3px; text-align: right; }
      .sys { align-self: center; font-size: 12.5px; color: var(--color-text-muted); text-align: center; padding: 2px 10px; }
      .reply { margin-bottom: 14px; }
      .reply textarea { resize: vertical; }
      .reply-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
      .alert a { font-weight: 600; text-decoration: underline; }
      .stars { display: flex; gap: 4px; margin-bottom: 10px; }
      .stars button, .stars.readonly span { background: none; border: none; font-size: 30px; line-height: 1; padding: 0 2px; color: #d1d5db; cursor: pointer; width: auto; }
      .stars.readonly span { cursor: default; }
      .stars button.on, .stars.readonly span.on { color: #f59e0b; }
      .rating textarea { margin-bottom: 10px; resize: vertical; }
      @media (max-width: 640px) { .bubble { max-width: 92%; } }
    `,
  ],
})
export class TicketDetailPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly tickets = inject(TicketService);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  readonly starValues = [1, 2, 3, 4, 5];
  readonly ticketId = signal<number | null>(null);
  readonly ticket = signal<TicketDetail | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly draft = signal('');
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);

  readonly stars = signal(0);
  readonly hoverStars = signal(0);
  readonly comment = signal('');
  readonly rating = signal(false);
  readonly ratingError = signal<string | null>(null);

  readonly isOpen = computed(() => this.ticket()?.status !== 'closed');

  category = ticketCategoryLabel;
  time = formatVnDateTime;

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') void this.poll();
  };

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = Number(params.get('id'));
      this.stopPolling();
      if (!Number.isInteger(id) || id <= 0) {
        this.ticketId.set(null);
        this.loading.set(false);
        this.notFound.set(true);
        return;
      }
      this.ticketId.set(id);
      void this.load();
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  async load(): Promise<void> {
    const id = this.ticketId();
    if (id === null) return;

    this.loading.set(true);
    this.loadError.set(null);
    this.notFound.set(false);
    try {
      this.ticket.set(await this.tickets.get(id));
      this.startPolling();
      this.scrollToBottom();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) this.notFound.set(true);
      else this.loadError.set(errorMessage(e, 'Không tải được yêu cầu hỗ trợ'));
    } finally {
      this.loading.set(false);
    }
  }

  // ===== Polling 10 giây, chỉ khi tab đang hiển thị =====

  private startPolling(): void {
    if (!this.isBrowser || this.timer) return;
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.poll();
    }, POLL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.isBrowser) document.removeEventListener('visibilitychange', this.onVisible);
  }

  private async poll(): Promise<void> {
    const id = this.ticketId();
    if (id === null || this.sending() || this.rating()) return;

    try {
      const fresh = await this.tickets.get(id);
      const current = this.ticket();
      if (!current || fresh.updatedAt !== current.updatedAt || fresh.messages.length !== current.messages.length || fresh.status !== current.status) {
        const grew = !current || fresh.messages.length > current.messages.length;
        this.ticket.set(fresh);
        if (grew) this.scrollToBottom();
      }
    } catch {
      // lỗi mạng khi polling: giữ dữ liệu cũ, lần sau thử lại
    }
  }

  private scrollToBottom(): void {
    if (!this.isBrowser) return;
    setTimeout(() => {
      const el = this.thread()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  // ===== Trả lời =====

  async onSend(event: Event): Promise<void> {
    event.preventDefault();
    const id = this.ticketId();
    const body = this.draft().trim();
    if (id === null || this.sending() || body.length === 0) return;
    if (body.length > BODY_MAX) {
      this.sendError.set(`Nội dung tối đa ${BODY_MAX} ký tự`);
      return;
    }

    this.sending.set(true);
    this.sendError.set(null);
    try {
      await this.tickets.send(id, body);
      this.draft.set('');
      this.ticket.set(await this.tickets.get(id)); // lấy lại để có trạng thái mới (ví dụ resolved → open)
      this.scrollToBottom();
    } catch (e) {
      this.sendError.set(errorMessage(e, 'Không gửi được tin nhắn, vui lòng thử lại'));
      if (e instanceof ApiError && e.code === 'TICKET_CLOSED') void this.load();
    } finally {
      this.sending.set(false);
    }
  }

  // ===== Đánh giá =====

  async onRate(): Promise<void> {
    const id = this.ticketId();
    if (id === null || this.rating() || this.stars() === 0) return;

    const comment = this.comment().trim();
    if (comment.length > COMMENT_MAX) {
      this.ratingError.set(`Nhận xét tối đa ${COMMENT_MAX} ký tự`);
      return;
    }

    this.rating.set(true);
    this.ratingError.set(null);
    try {
      const res = await this.tickets.rate(id, this.stars(), comment || null);
      this.ticket.update((t) => (t ? { ...t, rating: res.rating, ratingComment: res.ratingComment } : t));
      this.toast.success('Cảm ơn bạn đã đánh giá');
    } catch (e) {
      this.ratingError.set(errorMessage(e, 'Không gửi được đánh giá'));
      if (e instanceof ApiError && e.code === 'ALREADY_RATED') void this.load();
    } finally {
      this.rating.set(false);
    }
  }
}
