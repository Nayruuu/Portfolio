import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlayerService } from './player.service';

describe('PlayerService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });
  afterEach(() => vi.useRealTimers());

  it('currentChapter follows the time', () => {
    const svc = TestBed.inject(PlayerService);

    svc.pause();
    svc.seek(0);
    expect(svc.currentChapter()).toBeDefined();
    const chapters = svc.chapters();

    if (chapters.length > 1) {
      svc.seek(chapters[1].seconds + 1);
      expect(svc.currentChapter().id).toBe(chapters[1].id);
    }
  });

  it('seek clamps the time to [0, totalSec]', () => {
    const svc = TestBed.inject(PlayerService);

    svc.seek(-50);
    expect(svc.time()).toBe(0);
    svc.seek(svc.totalSec() + 999);
    expect(svc.time()).toBe(svc.totalSec());
  });

  it('togglePlay inverts the state', () => {
    const svc = TestBed.inject(PlayerService);
    const before = svc.playing();

    svc.togglePlay();
    expect(svc.playing()).toBe(!before);
  });

  it('nextChapter advances to the next chapter', () => {
    const svc = TestBed.inject(PlayerService);

    svc.pause();
    const chapters = svc.chapters();

    svc.seek(chapters[0].seconds);
    svc.nextChapter();
    if (chapters.length > 1) {
      expect(svc.time()).toBe(chapters[1].seconds);
    }
  });

  it('the tick advances the time while playing, and onCleanup stops it on pause', () => {
    vi.useFakeTimers();
    const svc = TestBed.inject(PlayerService);
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick(); // flush the effect → schedules setInterval

    const timeBefore = svc.time();

    vi.advanceTimersByTime(100);
    expect(svc.time()).toBeCloseTo(timeBefore + 0.1, 5);

    // pause → the effect re-runs and onCleanup clears the interval
    svc.pause();
    appRef.tick();
    const timeAfterPause = svc.time();

    vi.advanceTimersByTime(1000);
    expect(svc.time()).toBe(timeAfterPause);
  });

  it('nextChapter wraps from the last chapter back to the first', () => {
    const svc = TestBed.inject(PlayerService);

    svc.pause();
    const chapters = svc.chapters();
    const last = chapters[chapters.length - 1];

    svc.seek(last.seconds);
    expect(svc.currentChapter().id).toBe(last.id);
    svc.nextChapter(); // (currentIndex + 1) % chapterList.length → wraps back to the first chapter
    expect(svc.time()).toBe(chapters[0].seconds);
    expect(svc.currentChapter().id).toBe(chapters[0].id);
  });

  it('the tick wraps the time to 0 upon reaching totalSec', () => {
    vi.useFakeTimers();
    const svc = TestBed.inject(PlayerService);
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick(); // flush the effect → schedules setInterval

    const total = svc.totalSec();

    svc.seek(total - 0.05);
    vi.advanceTimersByTime(100); // next = total + 0.05 >= total → wraps to 0
    expect(svc.time()).toBe(0);
  });

  it('chapterElapsed = time - currentChapter().seconds', () => {
    const svc = TestBed.inject(PlayerService);

    svc.pause();
    const chapters = svc.chapters();
    const chapter = chapters[1] ?? chapters[0];

    svc.seek(chapter.seconds + 3);
    expect(svc.currentChapter().id).toBe(chapter.id);
    expect(svc.chapterElapsed()).toBeCloseTo(svc.time() - chapter.seconds, 5);
  });

  it('currentChapter: t exactly on c.seconds selects that chapter', () => {
    const svc = TestBed.inject(PlayerService);

    svc.pause();
    const chapters = svc.chapters();

    for (const chapter of chapters) {
      svc.seek(chapter.seconds);
      expect(svc.currentChapter().id).toBe(chapter.id);
    }
  });

  it('currentChapter: t between two chapters returns the previous one', () => {
    const svc = TestBed.inject(PlayerService);

    svc.pause();
    const chapters = svc.chapters();

    if (chapters.length > 1) {
      const previousChapter = chapters[0];
      const nextChapter = chapters[1];
      const midpoint = (previousChapter.seconds + nextChapter.seconds) / 2;

      svc.seek(midpoint);
      expect(svc.currentChapter().id).toBe(previousChapter.id);
    }
  });

  it('play() forces playing=true', () => {
    const svc = TestBed.inject(PlayerService);

    svc.pause();
    expect(svc.playing()).toBe(false);
    svc.play();
    expect(svc.playing()).toBe(true);
  });
});
