import { Component, computed, input } from '@angular/core';
import { ticketStatusLabel } from '../../utils/ticket-text';

/** Chip trạng thái ticket, dùng ở danh sách và chi tiết (nông dân và nhân viên). */
@Component({
  selector: 'app-ticket-status-chip',
  standalone: true,
  template: `<span class="chip" [class]="'chip chip-' + status()">{{ label() }}</span>`,
  styles: [
    `
      .chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
      .chip-open { background: #dbeafe; color: #1e40af; }
      .chip-in_progress { background: #e0e7ff; color: #3730a3; }
      .chip-waiting_customer { background: #fef3c7; color: #92400e; }
      .chip-resolved { background: var(--color-primary-light); color: var(--color-primary-dark); }
      .chip-closed { background: #f3f4f6; color: #6b7280; }
    `,
  ],
})
export class TicketStatusChipComponent {
  readonly status = input.required<string>();
  readonly label = computed(() => ticketStatusLabel(this.status()));
}
