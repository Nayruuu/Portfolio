// core/lib/game/registry — the level REGISTRY + dev-time URL overrides: the `LEVELS` map (URL key → the
// authored {@link Level} data), the default key, and the two PURE resolvers the game loads every zone
// through — `parseLevelParams` (a `location.search` string → dev params) and `resolveZone` (key + entry +
// params → the zone to mount). Pure data + pure functions; zero DOM. Re-exported through the game sub-barrel.
export * from './level-select';
