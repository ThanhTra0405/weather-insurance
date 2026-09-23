import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConnectWalletButton } from './connect-wallet-button';

describe('ConnectWalletButton', () => {
  let component: ConnectWalletButton;
  let fixture: ComponentFixture<ConnectWalletButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectWalletButton]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ConnectWalletButton);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
