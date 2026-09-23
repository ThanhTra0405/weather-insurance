import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ConnectWalletButtonComponent } from './components/connect-wallet-button/connect-wallet-button';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConnectWalletButtonComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}