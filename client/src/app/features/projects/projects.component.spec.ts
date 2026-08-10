import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectsComponent } from './projects.component';

describe('ProjectsComponent', () => {
  let fixture: ComponentFixture<ProjectsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProjectsComponent] }).compileComponents();
    fixture = TestBed.createComponent(ProjectsComponent);
  });

  it('mounts and renders a card per project with a page', async () => {
    await fixture.whenStable();
    const cards = fixture.nativeElement.querySelectorAll('.proj-card');

    expect(cards.length).toBeGreaterThan(0);
  });
});
