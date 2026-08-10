import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CodeBlockComponent } from './code-block.component';

describe('CodeBlockComponent', () => {
  let fixture: ComponentFixture<CodeBlockComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CodeBlockComponent] }).compileComponents();
    fixture = TestBed.createComponent(CodeBlockComponent);
    fixture.componentRef.setInput('code', 'const answer = 42;');
    fixture.componentRef.setInput('lang', 'typescript');
  });

  it('renders the provided code', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('answer');
  });
});
