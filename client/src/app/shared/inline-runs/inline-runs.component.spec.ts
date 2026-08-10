import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InlineRunsComponent } from './inline-runs.component';
import type { InlineRun } from '../../domain';

describe('InlineRunsComponent', () => {
  let fixture: ComponentFixture<InlineRunsComponent>;

  const render = async (runs: InlineRun[]): Promise<HTMLElement> => {
    fixture.componentRef.setInput('runs', runs);
    await fixture.whenStable();

    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InlineRunsComponent] }).compileComponents();
    fixture = TestBed.createComponent(InlineRunsComponent);
  });

  it('renders a text run as bare text', async () => {
    const host = await render([{ kind: 'text', text: 'plain words' }]);

    expect(host.textContent).toContain('plain words');
    expect(host.querySelector('strong')).toBeNull();
    expect(host.querySelector('code')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
  });

  it('renders a bold run as <strong>', async () => {
    const host = await render([{ kind: 'bold', text: 'emphasis' }]);
    const strong = host.querySelector('strong');

    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('emphasis');
  });

  it('renders a code run as <code class="inline-runs__code">', async () => {
    const host = await render([{ kind: 'code', text: 'const x = 1;' }]);
    const code = host.querySelector('code.inline-runs__code');

    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('const x = 1;');
  });

  it('renders an external link run with href, text and a safe new-tab target', async () => {
    const host = await render([{ kind: 'link', text: 'super-dev', href: 'https://super-dev.app' }]);
    const link = host.querySelector('a.inline-runs__link');

    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://super-dev.app');
    expect(link?.textContent).toBe('super-dev');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps a relative link in the same tab (no target/rel)', async () => {
    const host = await render([{ kind: 'link', text: 'docs', href: '/fr/articles/intro' }]);
    const link = host.querySelector('a.inline-runs__link');

    expect(link?.getAttribute('href')).toBe('/fr/articles/intro');
    expect(link?.getAttribute('target')).toBeNull();
    expect(link?.getAttribute('rel')).toBeNull();
  });
});
