import type { ModuleDef } from './module';

/**
 * Campaign level 1 — "Accueil" (the office reception). A hand-drawn 40×42 map, kept in its own file so the
 * geometry can be refined by eye without touching the build pipeline. Every char is a `DEFAULT_LEGEND`
 * entry (no per-module legend needed):
 *
 *   `#` wall · `.` floor · `S` spawn · `P` health · `V` armor · `A` ammo
 *   `d` junior drone · `E` husk (melee) · `m` middle manager · `G` security guard
 *   `j` blue keycard · `b` blue locked door (solid, opened by the blue key) · `X` exit switch
 *   `q`/`e`/`z`/`c` 45° corner chamfers (NW/NE/SW/SE) — the atrium's octagon
 *
 * The intended route: RÉCEPTION (spawn `S`, health `P`, ammo `A`) → a central corridor up into the LOBBY hub
 * (three drones `d`, a husk `E` ambush in the SW corner) → the open east passage into the CUBICLE MAZE (the
 * blue keycard `j` up top, a guard `G` mid-room) → the maze's east BLUE DOOR `b` → the ATRIUM (the octagonal
 * landmark: the exit switch `X` on its north wall, a guard `G` + drones) → a south BLUE DOOR `b` shortcut back
 * down into the lobby (the loop). A BREAK ROOM hangs off the lobby's west wall; one non-obvious gap drops into
 * a hidden alcove holding the armor `V` (the "secret" — no new mechanic, just a gap).
 *
 * Both atrium entrances are blue-keyed, so the exit genuinely requires the keycard the maze hands out; the key
 * itself is reachable from the spawn WITHOUT crossing any door. (Invariants — reachability, key-before-door, a
 * single exit switch — are asserted structurally in `campaign.spec.ts`, never by exact coordinate, so this map
 * stays freely editable.)
 */
export const ACCUEIL: ModuleDef = {
  name: 'accueil',
  role: 'landmark',
  layout: `########################################
           ########################################
           ########################################
           ####################X###################
           #############qqq..........eee###########
           #############qq............ee###########
           #############q..d........d..e#.........#
           #############................#.........#
           #############.......G........#....j....#
           #############................b.........#
           #############................b..#..#...#
           #############................#.........#
           #############z..............c#.........#
           #############zz............cc#.........#
           #############zzz..........ccc#...#..#..#
           ###################..#########.........#
           ###################bb#########.........#
           ###################..#########.........#
           #############...............##..#......#
           #############...............##.........#
           ###.........#...............##....G....#
           ###.........#...............##.........#
           ###..E......#...d.......d..........#...#
           ###.........#..........................#
           ###.........................##.........#
           ###.........#...............##.........#
           ###.........#...............##...#..#..#
           ###.........#...............##.........#
           ###.........#.......d.......##.........#
           #####.#######...............##.........#
           ####...######.EE............##.........#
           ####.V.######...............############
           ###################..###################
           ###################..###################
           ###############...........##############
           ###############...........##############
           ###############...........##############
           ###############.....S.....##############
           ###############..P.....A..##############
           ###############...........##############
           ###############...........##############
           ########################################`,
};
