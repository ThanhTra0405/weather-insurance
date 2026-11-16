import { Component, computed, input } from '@angular/core';
import { ticketPriorityLabel } from '../../utils/ticket-text';

/** Nhãn mức ưu tiên ticket (thấp / bình thường / cao). */
@Component({
  selector: 'app-ticket-priority-badge',
  standalone: true,
  template: `<span class="prio" [class]="'prio prio-' + priority()">{{ label() }}</span>`,
  styles: [
    `
      .prio { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
      .prio-low { background: #f3f4f6; color: #6b7280; }
      .prio-normal { background: var(--color-bg-secondary); color: var(--color-primary-dark); }
      .prio-high { background: #fee2e2; color: #991b1b; }
    `,
  ],
})
export class TicketPriorityBadgeComponent {
  readonly priority = input.required<string>();
  readonly label = computed(() => ticketPriorityLabel(this.priority()));
}
