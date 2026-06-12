import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';

describe('IconComponent', () => {
  let fixture: ComponentFixture<IconComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [IconComponent] }).compileComponents();
    fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'moon');
  });

  it('renders an <svg> for a known name', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('svg')).toBeTruthy();
  });
});
