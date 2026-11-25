export const WINDOW_OPACITY_KEY = "procweaver_window_opacity";
export const MIN_WINDOW_OPACITY = 20;
export const MAX_WINDOW_OPACITY = 100;
export const DEFAULT_WINDOW_OPACITY = MAX_WINDOW_OPACITY;

export function readWindowOpacity(): number {
  try {
    const percent = Math.round(Number(localStorage.getItem(WINDOW_OPACITY_KEY)) * 100);
    if (percent >= MIN_WINDOW_OPACITY && percent <= MAX_WINDOW_OPACITY) return percent;
  } catch {
    // The window can still render when storage is unavailable.
  }
  return DEFAULT_WINDOW_OPACITY;
}
