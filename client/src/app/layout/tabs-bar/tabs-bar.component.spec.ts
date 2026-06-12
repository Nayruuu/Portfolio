import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabsBarComponent } from './tabs-bar.component';

describe('TabsBarComponent', () => {
  let fixture: ComponentFixture<TabsBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TabsBarComponent] }).compileComponents();
    fixture = TestBed.createComponent(TabsBarComponent);
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });
});
