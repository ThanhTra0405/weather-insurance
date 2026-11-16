import { Component, ElementRef, OnDestroy, PLATFORM_ID, computed, inject, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EvidenceViewerComponent } from '../../components/evidence-viewer/evidence-viewer';
import { TicketPriorityBadgeComponent } from '../../components/ticket-priority-badge/ticket-priority-badge';
import { TicketStatusChipComponent } from '../../components/ticket-status-chip/ticket-status-chip';
import { PolicyDetail } from '../../models/policy.models';
import { CannedReply, StaffAccount, StaffTicketDetail, TicketPatch, TicketPriority, TicketStatus } from '../../models/ticket.models';
import { AdminStaffService } from '../../services/admin-staff.service';
import { AuthService } from '../../services/auth.service';
import { PolicyService } from '../../services/policy.service';
import { StaffTicketService } from '../../services/staff-ticket.service';
import { ToastService } from '../../services/toast.service';
import { errorMessage, isForbidden, isNotFound } from '../../utils/api-helpers';
import { explorerTxUrl, formatEth, formatVnDateTime, perilIcon, perilLabel, policyStatusView, shortHash } from '../../utils/format';
import { TICKET_PRIORITIES, TICKET_STATUSES, fillCannedTemplate, ticketCategoryLabel } from '../../utils/ticket-text';

const POLL_MS = 10_000;
const BODY_MAX = 4000;

const TIMELINE_LABELS: Record<string, string> = {
  created: 'Đã mua',
  evidence: 'Đã gửi hồ sơ',
  verified: 'Được duyệt / từ chối',
  payout: 'Đã bồi thường',
  expired: 'Hết hạn',
};

/** /support/ticket/:id: hội thoại + ghi chú nội bộ + mẫu trả lời; bên phải hồ sơ nông dân, policy, điều khiển (SPEC-B mục 9.4.3). */
@Component({
  selector: 'app-support-ticket',
  standalone: true,
  imports: [RouterLink, TicketStatusChipComponent, TicketPriorityBadgeComponent, EvidenceViewerComponent],
  template: `
    <div class="container page">
      <p class="back"><a routerLink="/support">← Hàng đợi</a></p>

      @if (loading()) {
        <div class="card state-box" role="status"><span class="spinner" aria-hidden="true"></span> Đang tải...</div>
      } @else if (notFound()) {
        <div class="card state-box">
          <h1>Không tìm thấy yêu cầu</h1>
          <p>Yêu cầu không tồn tại hoặc đã bị xoá.</p>
          <a routerLink="/support" class="btn btn-primary">Về hàng đợi</a>
        </div>
      } @else if (forbidden()) {
        <div class="card state-box">
          <h1>Không có quyền</h1>
          <p>Tài khoản của bạn không được xem yêu cầu này.</p>
          <a routerLink="/support" class="btn btn-primary">Về hàng đợi</a>
        </div>
      } @else if (loadError(); as le) {
        <div class="card state-box" role="alert">
          <div class="alert alert-error">{{ le }}</div>
          <button type="button" class="btn btn-outline" (click)="load()">Thử lại</button>
        </div>
      } @else if (ticket(); as t) {
        <div class="title-row">
          <h1>{{ t.subject }}</h1>
          <div class="chips"><app-ticket-status-chip [status]="t.status" /><app-ticket-priority-badge [priority]="t.priority" /></div>
        </div>
        <p class="meta">
          #{{ t.id }} · {{ category(t.category) }}
          @if (t.policyId) { · Policy #{{ t.policyId }} }
          · Tạo {{ time(t.createdAt) }}
          @if (t.rating !== null) { · Đánh giá: {{ t.rating }}/5 ★ }
        </p>

        <div class="layout">
          <!-- ===== Cột trái: hội thoại ===== -->
          <section class="left">
            <div class="thread card" #thread aria-live="polite">
              @for (m of t.messages; track m.id) {
                @if (m.senderType === 'system') {
                  <div class="sys">{{ m.body }} · {{ time(m.createdAt) }}</div>
                } @else {
                  <div class="row" [class.mine]="m.senderType === 'staff'">
                    <div class="bubble" [class.staff]="m.senderType === 'staff'" [class.internal]="m.isInternal">
                      <div class="who">
                        {{ m.senderType === 'farmer' ? (t.farmer?.fullName ?? 'Nông dân') : (m.senderName ?? 'CSKH') }}
                        @if (m.isInternal) { <span class="tag-internal">Ghi chú nội bộ</span> }
                      </div>
                      <div class="text">{{ m.body }}</div>
                      <div class="time">{{ time(m.createdAt) }}</div>
                    </div>
                  </div>
                }
              }
            </div>

            <form class="card reply" (submit)="onSend($event)">
              <div class="reply-top">
                <label class="check-row">
                  <input type="checkbox" [checked]="internal()" (change)="internal.set($any($event.target).checked)" />
                  <span>Ghi chú nội bộ (nông dân không thấy)</span>
                </label>
                <div class="canned">
                  <label for="canned" class="sr-only">Chèn mẫu trả lời</label>
                  <select id="canned" (focus)="ensureCanned()" (change)="insertCanned($any($event.target))">
                    <option value="">+ Chèn mẫu trả lời</option>
                    @for (c of canned(); track c.id) { <option [value]="c.id">{{ c.title }}</option> }
                  </select>
                </div>
              </div>
              @if (t.status === 'closed' && !internal()) {
                <p class="alert alert-warning">Ticket đã đóng: chỉ gửi được ghi chú nội bộ.</p>
              }
              <label for="reply" class="sr-only">Nội dung</label>
              <textarea id="reply" rows="4" maxlength="4000" [class.internal-box]="internal()"
                [placeholder]="internal() ? 'Ghi chú nội bộ cho đồng nghiệp...' : 'Trả lời nông dân... (Ctrl+Enter để gửi)'"
                [value]="draft()" (input)="draft.set($any($event.target).value)" (keydown.control.enter)="onSend($event)"
                (keydown.meta.enter)="onSend($event)" [disabled]="sending()"></textarea>
              @if (sendError(); as se) { <p class="field-error" role="alert">{{ se }}</p> }
              <div class="reply-actions">
                <span class="hint">{{ draft().length }}/4000</span>
                <button type="submit" class="btn btn-primary" [disabled]="sending() || draft().trim().length === 0 || (t.status === 'closed' && !internal())">
                  @if (sending()) { <span class="spinner" aria-hidden="true"></span> Đang gửi... }
                  @else { {{ internal() ? 'Lưu ghi chú' : 'Gửi trả lời' }} }
                </button>
              </div>
            </form>
          </section>

          <!-- ===== Cột phải: thông tin và điều khiển ===== -->
          <aside class="right">
            <section class="card side">
              <h2>Xử lý ticket</h2>
              <div class="ctl">
                <label for="c-status">Trạng thái</label>
                <select id="c-status" [disabled]="patching()" (change)="onStatus($any($event.target).value)">
                  @for (s of statuses; track s.value) { <option [value]="s.value" [selected]="t.status === s.value">{{ s.label }}</option> }
                </select>
              </div>
              <div class="ctl">
                <label for="c-prio">Ưu tiên</label>
                <select id="c-prio" [disabled]="patching()" (change)="onPriority($any($event.target).value)">
                  @for (p of priorities; track p.value) { <option [value]="p.value" [selected]="t.priority === p.value">{{ p.label }}</option> }
                </select>
              </div>
              <div class="ctl">
                <span class="lbl">Người xử lý</span>
                <div class="assignee">{{ t.assignedToName ?? 'Chưa gán' }}@if (isMine()) { (bạn) }</div>
                @if (isAdmin()) {
                  <label for="c-assign" class="sr-only">Gán cho</label>
                  <select id="c-assign" [disabled]="patching()" (change)="onAssign($any($event.target).value)">
                    <option value="__keep" selected>Chọn người xử lý...</option>
                    <option value="">Bỏ gán</option>
                    @for (s of staffOptions(); track s.id) { <option [value]="s.id">{{ s.fullName }} ({{ s.role }})</option> }
                  </select>
                } @else {
                  <div class="assign-btns">
                    @if (!isMine()) {
                      <button type="button" class="btn btn-primary btn-sm" [disabled]="patching()" (click)="patch({ assignedTo: 'me' }, 'Đã nhận ticket')">Nhận ticket</button>
                    } @else {
                      <button type="button" class="btn btn-outline btn-sm" [disabled]="patching()" (click)="patch({ assignedTo: '' }, 'Đã bỏ gán ticket')">Trả lại hàng đợi</button>
                    }
                  </div>
                }
                @if (isAdmin() && !isMine()) {
                  <button type="button" class="btn btn-outline btn-sm" [disabled]="patching()" (click)="patch({ assignedTo: 'me' }, 'Đã nhận ticket')">Nhận cho tôi</button>
                }
              </div>
              @if (patchError(); as pe) { <p class="field-error" role="alert">{{ pe }}</p> }
            </section>

            <section class="card side">
              <h2>Nông dân</h2>
              @if (t.farmer; as f) {
                <dl class="info">
                  <dt>Họ tên</dt><dd>{{ f.fullName }}</dd>
                  <dt>Ví</dt><dd class="mono">{{ shortWallet(f.walletAddress) }}</dd>
                  <dt>Điện thoại</dt><dd>{{ f.phone ?? '—' }}</dd>
                  <dt>Email</dt><dd>{{ f.email ?? '—' }}</dd>
                  <dt>Địa chỉ</dt><dd>{{ f.commune ? f.commune + ', ' : '' }}{{ f.district }}, {{ f.province }}</dd>
                  <dt>Cây trồng</dt><dd>{{ f.cropType }} · {{ f.farmAreaHa }} ha</dd>
                </dl>
                @if (!isAdmin()) { <p class="hint">Email và số điện thoại được che với tài khoản CSKH.</p> }
                <a class="btn btn-outline btn-sm" routerLink="/support/lookup" [queryParams]="{ q: f.walletAddress }">Tra cứu toàn bộ policy</a>
              } @else {
                <p class="muted-text">Không có hồ sơ nông dân.</p>
              }
            </section>

            @if (t.policyId) {
              <section class="card side">
                <h2>Policy #{{ t.policyId }}</h2>
                @if (t.policy; as p) {
                  <div class="pol-top">
                    <span>{{ icon(p.perilType) }} {{ p.productName ?? peril(p.perilType) }}</span>
                    <span class="badge" [class]="'badge ' + statusView(p).cls">{{ statusView(p).label }}</span>
                  </div>
                  <dl class="info">
                    <dt>Phí</dt><dd>{{ eth(p.premiumWei) }} ETH</dd>
                    <dt>Bồi thường</dt><dd>{{ eth(p.coverageWei) }} ETH</dd>
                    <dt>Hiệu lực</dt><dd>{{ date(p.startTime) }} → {{ date(p.endTime) }}</dd>
                  </dl>
                  @if (p.rejected && p.rejectReason) {
                    <div class="alert alert-error"><strong>Lý do từ chối:</strong> {{ p.rejectReason }}</div>
                  }
                  <app-evidence-viewer [policyId]="p.policyId" />

                  @if (timeline(); as tl) {
                    @if (tl.length > 0) {
                      <h3>Dòng thời gian</h3>
                      <ol class="timeline">
                        @for (ev of tl; track $index) {
                          <li>
                            <strong>{{ tlLabel(ev.type) }}</strong>
                            <span class="hint">{{ time(ev.time) }}</span>
                            @if (txUrl(ev.txHash); as url) { <a [href]="url" target="_blank" rel="noopener noreferrer" class="mono">{{ short(ev.txHash) }}</a> }
                          </li>
                        }
                      </ol>
                    }
                  }
                } @else {
                  <p class="muted-text">Chưa có dữ liệu policy này trong hệ thống (indexer chưa đồng bộ).</p>
                }
              </section>
            }
          </aside>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .page { padding-top: 16px; padding-bottom: 60px; }
      .back { margin: 0 0 10px; font-size: 14px; }
      h1 { font-size: 21px; margin: 0; word-break: break-word; }
      h2 { font-size: 15px; margin: 0 0 10px; color: var(--color-primary-dark); }
      h3 { font-size: 13px; margin: 12px 0 6px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
      .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .chips { display: flex; gap: 6px; }
      .meta { font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 14px; }
      .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
      .thread { display: flex; flex-direction: column; gap: 10px; max-height: 58vh; overflow-y: auto; margin-bottom: 14px; padding: 14px; }
      .row { display: flex; }
      .row.mine { justify-content: flex-end; }
      .bubble { max-width: 82%; background: #f3f4f6; border-radius: 14px 14px 14px 4px; padding: 8px 12px; }
      .bubble.staff { background: var(--color-primary-light); border-radius: 14px 14px 4px 14px; }
      .bubble.internal { background: #fffbeb; border: 1px dashed var(--color-warning); }
      .who { font-size: 12px; font-weight: 700; color: var(--color-text-secondary); margin-bottom: 2px; }
      .tag-internal { margin-left: 6px; font-size: 11px; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 1px 7px; }
      .text { font-size: 14.5px; white-space: pre-wrap; word-break: break-word; }
      .time { font-size: 11.5px; color: var(--color-text-muted); margin-top: 3px; text-align: right; }
      .sys { align-self: center; font-size: 12.5px; color: var(--color-text-muted); text-align: center; padding: 2px 10px; }
      .reply textarea { resize: vertical; }
      .reply textarea.internal-box { background: #fffbeb; border-color: var(--color-warning); }
      .reply-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
      .canned select { padding: 7px 10px; font-size: 14px; width: auto; max-width: 240px; }
      .reply-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
      .hint { font-size: 12.5px; color: var(--color-text-muted); margin: 0; }
      .right { display: grid; gap: 14px; }
      .side { padding: 16px; }
      .ctl { margin-bottom: 12px; }
      .ctl label, .lbl { font-size: 12.5px; display: block; margin-bottom: 4px; font-weight: 600; color: var(--color-text-secondary); }
      .ctl select { padding: 8px 10px; font-size: 14px; }
      .assignee { font-weight: 600; margin-bottom: 6px; }
      .assign-btns { display: flex; gap: 8px; }
      .info { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 10px; font-size: 13.5px; }
      .info dt { color: var(--color-text-secondary); }
      .info dd { margin: 0; font-weight: 600; word-break: break-word; }
      .pol-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 600; font-size: 14px; }
      .muted-text { color: var(--color-text-secondary); font-size: 14px; margin: 0; }
      .timeline { list-style: none; margin: 0; padding: 0 0 0 12px; border-left: 2px solid var(--color-border); display: grid; gap: 8px; font-size: 13px; }
      .timeline li { display: flex; flex-direction: column; gap: 1px; }
      @media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } }
      @media (max-width: 640px) { .bubble { max-width: 92%; } }
    `,
  ],
})
export class SupportTicketPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly svc = inject(StaffTicketService);
  private readonly adminStaff = inject(AdminStaffService);
  private readonly policies = inject(PolicyService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  readonly statuses = TICKET_STATUSES;
  readonly priorities = TICKET_PRIORITIES;

  readonly ticketId = signal<number | null>(null);
  readonly ticket = signal<StaffTicketDetail | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly forbidden = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly draft = signal('');
  readonly internal = signal(false);
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);

  readonly patching = signal(false);
  readonly patchError = signal<string | null>(null);

  readonly canned = signal<CannedReply[]>([]);
  private cannedLoaded = false;
  readonly staffList = signal<StaffAccount[]>([]);
  readonly timeline = signal<PolicyDetail['timeline'] | null>(null);

  readonly isAdmin = computed(() => this.auth.role() === 'admin');
  readonly isMine = computed(() => {
    const t = this.ticket();
    return !!t && !!t.assignedTo && t.assignedTo === this.auth.staffId();
  });
  readonly staffOptions = computed(() => this.staffList().filter((s) => s.active));

  category = ticketCategoryLabel;
  time = formatVnDateTime;
  eth = formatEth;
  short = shortHash;
  peril = perilLabel;
  icon = perilIcon;
  tlLabel = (type: string): string => TIMELINE_LABELS[type] ?? type;
  txUrl = explorerTxUrl;
  statusView = (p: { status: number; rejected: boolean }) => policyStatusView(p.status, p.rejected);

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

  date(unix: number): string {
    return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(unix * 1000));
  }

  shortWallet(wallet: string): string {
    return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
  }

  async load(): Promise<void> {
    const id = this.ticketId();
    if (id === null) return;

    this.loading.set(true);
    this.loadError.set(null);
    this.notFound.set(false);
    this.forbidden.set(false);
    try {
      const t = await this.svc.get(id);
      this.ticket.set(t);
      this.startPolling();
      this.scrollToBottom();
      void this.loadExtras(t);
    } catch (e) {
      if (isNotFound(e)) this.notFound.set(true);
      else if (isForbidden(e)) this.forbidden.set(true);
      else this.loadError.set(errorMessage(e, 'Không tải được yêu cầu hỗ trợ'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Dữ liệu phụ (không chặn trang): danh sách nhân viên cho admin, timeline của policy. */
  private async loadExtras(t: StaffTicketDetail): Promise<void> {
    if (this.isAdmin() && this.staffList().length === 0) {
      this.adminStaff.list().then((l) => this.staffList.set(l)).catch(() => undefined);
    }
    this.timeline.set(null);
    if (t.policyId && t.policy) {
      try {
        const detail = await this.policies.detail(t.policyId);
        this.timeline.set(detail.timeline);
      } catch {
        this.timeline.set(null); // timeline là phần phụ, bỏ qua lỗi
      }
    }
  }

  async ensureCanned(): Promise<void> {
    if (this.cannedLoaded) return;
    this.cannedLoaded = true;
    try {
      this.canned.set(await this.svc.cannedList());
    } catch {
      this.cannedLoaded = false;
      this.toast.error('Không tải được mẫu trả lời');
    }
  }

  insertCanned(select: HTMLSelectElement): void {
    const id = Number(select.value);
    select.value = '';
    const reply = this.canned().find((c) => c.id === id);
    const t = this.ticket();
    if (!reply || !t) return;
    const text = fillCannedTemplate(reply.body, t.farmer?.fullName, t.policyId);
    const current = this.draft();
    this.draft.set(current.trim() ? `${current}\n${text}` : text);
  }

  // ===== Polling 10 giây khi tab hiển thị =====

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
    if (id === null || this.sending() || this.patching()) return;
    try {
      const fresh = await this.svc.get(id);
      const cur = this.ticket();
      if (!cur || fresh.updatedAt !== cur.updatedAt || fresh.messages.length !== cur.messages.length) {
        const grew = !cur || fresh.messages.length > cur.messages.length;
        this.ticket.set(fresh);
        if (grew) this.scrollToBottom();
      }
    } catch {
      // lỗi mạng khi polling: giữ dữ liệu cũ
    }
  }

  private scrollToBottom(): void {
    if (!this.isBrowser) return;
    setTimeout(() => {
      const el = this.thread()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  // ===== Trả lời / ghi chú =====

  async onSend(event: Event): Promise<void> {
    event.preventDefault();
    const id = this.ticketId();
    const body = this.draft().trim();
    const t = this.ticket();
    if (id === null || !t || this.sending() || body.length === 0) return;
    if (t.status === 'closed' && !this.internal()) return;
    if (body.length > BODY_MAX) {
      this.sendError.set(`Nội dung tối đa ${BODY_MAX} ký tự`);
      return;
    }

    this.sending.set(true);
    this.sendError.set(null);
    try {
      await this.svc.reply(id, body, this.internal());
      this.toast.success(this.internal() ? 'Đã lưu ghi chú nội bộ' : 'Đã gửi trả lời cho nông dân');
      this.draft.set('');
      this.ticket.set(await this.svc.get(id)); // trạng thái/người xử lý có thể tự đổi sau khi trả lời
      this.scrollToBottom();
    } catch (e) {
      this.sendError.set(errorMessage(e, 'Không gửi được, vui lòng thử lại'));
    } finally {
      this.sending.set(false);
    }
  }

  // ===== Điều khiển ticket =====

  onStatus(value: string): void {
    void this.patch({ status: value as TicketStatus }, 'Đã cập nhật trạng thái');
  }

  onPriority(value: string): void {
    void this.patch({ priority: value as TicketPriority }, 'Đã cập nhật mức ưu tiên');
  }

  onAssign(value: string): void {
    if (value === '__keep') return;
    void this.patch({ assignedTo: value }, value ? 'Đã gán người xử lý' : 'Đã bỏ gán ticket');
  }

  async patch(patch: TicketPatch, successMessage: string): Promise<void> {
    const id = this.ticketId();
    if (id === null || this.patching()) return;

    this.patching.set(true);
    this.patchError.set(null);
    try {
      await this.svc.patch(id, patch);
      this.toast.success(successMessage);
    } catch (e) {
      this.patchError.set(errorMessage(e, 'Không cập nhật được ticket'));
    } finally {
      this.patching.set(false);
    }
    // Luôn tải lại để các ô chọn khớp với dữ liệu thật trên server (kể cả khi lỗi).
    try {
      this.ticket.set(await this.svc.get(id));
      this.scrollToBottom();
    } catch {
      /* giữ dữ liệu cũ */
    }
  }
}
