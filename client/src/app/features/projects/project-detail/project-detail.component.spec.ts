import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectDetailComponent } from './project-detail.component';

describe('ProjectDetailComponent', () => {
  let fixture: ComponentFixture<ProjectDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProjectDetailComponent] }).compileComponents();
    fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.componentRef.setInput('slug', 'ngsharp');
  });

  it('mounts and renders the project resource links', async () => {
    await fixture.whenStable();
    const links = fixture.nativeElement.querySelectorAll('.proj-detail__link');

    expect(links.length).toBeGreaterThan(0);
  });

  it('renders the case-study sections for a project that has them', async () => {
    fixture.componentRef.setInput('slug', 'fluentgraphql');
    await fixture.whenStable();

    const narrative = fixture.nativeElement.querySelector('.proj-detail__narrative');
    const codeBlock = fixture.nativeElement.querySelector('sd-code-block');
    const highlights = fixture.nativeElement.querySelectorAll('.proj-detail__highlights li');

    expect(narrative?.textContent).toContain('GraphQL');
    expect(codeBlock).not.toBeNull();
    expect(highlights.length).toBeGreaterThan(0);
    // A code-sample project shows no `Aperçu` image — the two slots are mutually exclusive.
    expect(fixture.nativeElement.querySelector('.proj-detail__image')).toBeNull();
  });

  it('shows the preview image instead of a code sample for a visual project (universe-map)', async () => {
    // universe-map carries an `image` but NO `codeSample` — the `@if (codeSample())` guard renders
    // nothing while the `@if (image())` slot shows the screenshot, alongside the other sections.
    fixture.componentRef.setInput('slug', 'universe-map');
    await fixture.whenStable();

    const image: HTMLImageElement | null =
      fixture.nativeElement.querySelector('.proj-detail__image');

    expect(fixture.nativeElement.querySelector('sd-code-block')).toBeNull();
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('/projects/universe-map.webp');
    expect(image?.getAttribute('alt')?.length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('.proj-detail__narrative')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.proj-detail__highlights')).not.toBeNull();
  });

  it('shows the preview image and no code sample for the game (open-space-exe)', async () => {
    // The game swapped its code sample for an `Aperçu` screenshot — the image slot renders, the
    // code slot stays empty.
    fixture.componentRef.setInput('slug', 'open-space-exe');
    await fixture.whenStable();

    const image: HTMLImageElement | null =
      fixture.nativeElement.querySelector('.proj-detail__image');

    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('/projects/open-space-exe.webp');
    expect(fixture.nativeElement.querySelector('sd-code-block')).toBeNull();
  });
});
