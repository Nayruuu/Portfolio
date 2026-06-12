import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { PlayerService } from '../player/player.service';
import { EXIT_SWITCH, THEME_CYCLE, isWall } from '../../lib';

/** Every perimeter cell of a level is a solid wall (the arena is fully enclosed). */
function isEnclosed(map: { width: number; height: number; cells: readonly number[] }): boolean {
  for (let x = 0; x < map.width; x++) {
    if (!isWall(map, x, 0) || !isWall(map, x, map.height - 1)) {
      return false;
    }
  }
  for (let y = 0; y < map.height; y++) {
    if (!isWall(map, 0, y) || !isWall(map, map.width - 1, y)) {
      return false;
    }
  }

  return true;
}

describe('GameService', () => {
  let game: GameService;
  let player: PlayerService;

  beforeEach(() => {
    game = TestBed.inject(GameService);
    player = TestBed.inject(PlayerService);
  });

  it('starts in video mode', () => {
    expect(game.mode()).toBe('video');
    expect(game.running()).toBe(false);
  });

  it('enter() switches to game mode and pauses playback', () => {
    player.play();
    game.enter();

    expect(game.mode()).toBe('game');
    expect(game.running()).toBe(true);
    expect(player.playing()).toBe(false);
  });

  it('exit() returns to video and resumes playback that was running', () => {
    player.play();
    game.enter();
    game.exit();

    expect(game.mode()).toBe('video');
    expect(player.playing()).toBe(true);
  });

  it('exit() does not resume playback that was already paused', () => {
    player.pause();
    game.enter();
    game.exit();

    expect(player.playing()).toBe(false);
  });

  it("starts on level 0 with the campaign's first level: enclosed, spawn on open floor, an exit switch", () => {
    expect(game.levelIndex()).toBe(0);
    const level = game.level();

    expect(level.map.width).toBeGreaterThan(0);
    expect(isEnclosed(level.map)).toBe(true);
    expect(isWall(level.map, level.spawn.x, level.spawn.y)).toBe(false);
    expect(level.map.cells).toContain(EXIT_SWITCH);
  });

  it('produces a level that is a pure function of (runSeed, levelIndex) — same state ⇒ same level', () => {
    expect(game.level()).toBe(game.level()); // memoized: same (seed, index) ⇒ the identical Level
  });

  it('advanceLevel() bumps the index, which changes the produced level (campaign → endless fall-through)', () => {
    const first = game.level();

    expect(first.theme).toBe(THEME_CYCLE[0]); // the campaign opener ("Accueil")

    game.advanceLevel();
    expect(game.levelIndex()).toBe(1);
    const second = game.level();

    expect(JSON.stringify(second.map.cells)).not.toBe(JSON.stringify(first.map.cells)); // a different level
    expect(isWall(second.map, second.spawn.x, second.spawn.y)).toBe(false);
  });

  it('resetRun() returns to level 0', () => {
    game.advanceLevel();
    game.resetRun();
    expect(game.levelIndex()).toBe(0);
  });

  it('enter() resets to level 0', () => {
    game.advanceLevel();
    game.enter();
    expect(game.levelIndex()).toBe(0);
  });
});
