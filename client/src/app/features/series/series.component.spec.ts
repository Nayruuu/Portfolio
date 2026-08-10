import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SeriesComponent } from './series.component';

describe('SeriesComponent', () => {
  let fixture: ComponentFixture<SeriesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SeriesComponent] }).compileComponents();
    fixture = TestBed.createComponent(SeriesComponent);
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  it('renders the route-backed Articles | Séries toggle', async () => {
    await fixture.whenStable();

    const toggle = fixture.nativeElement.querySelector('sd-content-tabs');

    expect(toggle).not.toBeNull();
    expect(toggle.querySelectorAll('a.ctab')).toHaveLength(2);
  });
});
