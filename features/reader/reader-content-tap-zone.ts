/** Viewport-normalized bounds for tapping the reading column to toggle top chrome. */
const CENTER_TAP = {
  yMin: 0.2,
  yMax: 0.8,
  xMin: 0.15,
  xMax: 0.85,
} as const;

export function isReaderCenterTapZone(clientX: number, clientY: number): boolean {
  const y = clientY / window.innerHeight;
  const x = clientX / window.innerWidth;
  return y > CENTER_TAP.yMin && y < CENTER_TAP.yMax && x > CENTER_TAP.xMin && x < CENTER_TAP.xMax;
}
