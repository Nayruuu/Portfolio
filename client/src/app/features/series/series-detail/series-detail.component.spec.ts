import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SeriesDetailComponent } from './series-detail.component';

describe('SeriesDetailComponent', () => {
  let fixture: ComponentFixture<SeriesDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SeriesDetailComponent] }).compileComponents();
    fixture = TestBed.createComponent(SeriesDetailComponent);
    fixture.componentRef.setInput('slug', 'stack-full-stack-net-angular');
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });
});
