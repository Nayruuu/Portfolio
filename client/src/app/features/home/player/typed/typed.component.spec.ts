import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TypedComponent } from './typed.component';

describe('TypedComponent', () => {
  let fixture: ComponentFixture<TypedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TypedComponent] }).compileComponents();
    fixture = TestBed.createComponent(TypedComponent);
  });

  function setInputs(elapsed: number, at: number, text: string): void {
    fixture.componentRef.setInput('elapsed', elapsed);
    fixture.componentRef.setInput('at', at);
    fixture.componentRef.setInput('text', text);
  }

  it('shows nothing and no caret before `at`', async () => {
    setInputs(0.5, 1, 'Hello');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.typed__shown').textContent).toBe('');
    expect(fixture.nativeElement.querySelector('.typed__caret')).toBeNull();
    expect(fixture.nativeElement.querySelector('.typed__ghost').textContent).toBe('Hello');
  });

  it('types a prefix with a caret partway through (40 cps default)', async () => {
    setInputs(1.05, 1, 'Hello'); // 0.05s * 40 = 2 chars
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.typed__shown').textContent).toBe('He');
    expect(fixture.nativeElement.querySelector('.typed__caret')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.typed__ghost').textContent).toBe('llo');
  });

  it('shows the full text with no caret once done', async () => {
    setInputs(10, 1, 'Hello');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.typed__shown').textContent).toBe('Hello');
    expect(fixture.nativeElement.querySelector('.typed__caret')).toBeNull();
    expect(fixture.nativeElement.querySelector('.typed__ghost').textContent).toBe('');
  });
});
