import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArticleDetailComponent } from './article-detail.component';

describe('ArticleDetailComponent', () => {
  let fixture: ComponentFixture<ArticleDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ArticleDetailComponent] }).compileComponents();
    fixture = TestBed.createComponent(ArticleDetailComponent);
    fixture.componentRef.setInput('slug', 'etrangler-le-monolithe-dotnet');
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });
});
