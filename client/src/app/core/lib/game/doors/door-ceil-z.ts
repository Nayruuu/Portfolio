// At openness 0 the ceiling meets the floor → no headroom → physics blocks passage.
export function doorCeilZ(closedCeilZ: number, openCeilZ: number, openness: number): number {
  return closedCeilZ + (openCeilZ - closedCeilZ) * openness;
}
