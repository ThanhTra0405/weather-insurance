import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, PendingPolicy } from '../../services/admin.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit {
  private adminService = inject(AdminService);

  readonly keyInput = signal('');
  readonly policies = signal<PendingPolicy[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly processingId = signal<number | null>(null);

  get isLoggedIn(): boolean {
    return this.adminService.apiKey() !== null;
  }

  ngOnInit(): void {
    if (this.isLoggedIn) this.load();
  }

  login(): void {
    this.adminService.login(this.keyInput());
    this.load();
  }

  logout(): void {
    this.adminService.logout();
    this.policies.set([]);
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      this.policies.set(await this.adminService.getPendingPolicies());
    } catch (err: any) {
      this.error.set(err.message);
    } finally {
      this.isLoading.set(false);
    }
  }

  async review(policyId: number, approved: boolean): Promise<void> {
    this.processingId.set(policyId);
    try {
      await this.adminService.reviewPolicy(policyId, approved);
      await this.load();
    } catch (err: any) {
      this.error.set(err.message);
    } finally {
      this.processingId.set(null);
    }
  }

  formatLatLng(scaled: string): string {
    return (Number(scaled) / 1_000_000).toFixed(6);
  }
}