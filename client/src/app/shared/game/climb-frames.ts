/**
 * Served frames of the first-person two-handed MANTLE pull (reach → pull), drawn over the whole screen
 * while the player is hoisted over a too-tall-but-climbable ledge. Hands-only on a transparent background,
 * no ledge baked in (the real geometry shows through). Engine-agnostic — blitted by {@link ClimbView} from
 * both the grid raycaster and the BSP renderer; preloaded so they never pop in mid-climb.
 */
export const CLIMB_FRAME_URLS = ['/game/hands/climb/0.webp', '/game/hands/climb/1.webp'] as const;
