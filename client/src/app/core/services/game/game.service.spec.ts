import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { PlayerService } from '../player/player.service';

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
});
