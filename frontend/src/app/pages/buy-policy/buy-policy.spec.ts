import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BuyPolicy } from './buy-policy';

describe('BuyPolicy', () => {
  let component: BuyPolicy;
  let fixture: ComponentFixture<BuyPolicy>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BuyPolicy]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BuyPolicy);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
