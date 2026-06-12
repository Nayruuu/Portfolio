// super-dev — shared infra constants (storage keys / DOM attributes). Domain value sets
// (LANG / THEME) live in `domain/` — they are domain primitives, not infra config.

/** localStorage keys shared by the i18n / theme / reviews services. */
export const STORAGE_KEYS = {
  LANG: 'super-dev-lang',
  THEME: 'super-dev-theme',
  REVIEWS: 'super-dev-reviews',
} as const;

/** `<html data-theme="…">` attribute name driving the CSS overrides. */
export const DATA_THEME_ATTR = 'data-theme';

/**
 * Body-text typing speed for the player scenes (headlines keep `SCENE_HEADLINE_CPS`).
 * Floored near 30: the densest scene (stack, ~570 body chars over a 30 s chapter) must finish
 * typing inside its window — going much slower would cut its last lines off at the scene change.
 */
export const SCENE_BODY_CPS = 30;

/** Offset at which every player-scene headline starts typing (seconds of chapter-elapsed). */
export const SCENE_HEADLINE_AT = 0.2;

/** Typing speed of the red headline in every player scene (cps). */
export const SCENE_HEADLINE_CPS = 30;

/** Pause between the headline finishing and the body chain starting (seconds). */
export const SCENE_BODY_BREATH = 0.4;

/**
 * Extra dwell (seconds) inserted between cards/rows of the multi-item scenes (projects / stack /
 * timeline): each card's start times are pushed by `cardIndex * SCENE_CARD_DWELL`, so a completed
 * card lingers before the next begins — the mobile montage doesn't flick to the next item too fast
 * (and the desktop reveal paces likewise). Chapter windows are sized to absorb it.
 */
export const SCENE_CARD_DWELL = 1.2;
