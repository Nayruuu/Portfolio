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
});
