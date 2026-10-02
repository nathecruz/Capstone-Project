/** Horizontal room kept at both ends of a line chart so the first and last points are not clipped. */
export const CHART_X_INSET = 16;

/**
 * Points and connecting segments of a 0–100 line chart, in pixels of the measured plot.
 * (Percentages mix the plot's width and height, so lines point the wrong way whenever the
 * chart is not phone-sized.) Each segment is a thin view rotated from its left end.
 */
export function getChartGeometry(rates: number[], width: number, height: number) {
  const step = (width - CHART_X_INSET * 2) / Math.max(1, rates.length - 1);
  const points = rates.map((rate, index) => ({ x: CHART_X_INSET + index * step, y: height - (Math.max(0, Math.min(100, rate)) / 100) * height }));
  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    return { left: point.x, top: point.y - 1, width: Math.sqrt(dx ** 2 + dy ** 2), transform: [{ rotate: `${Math.atan2(dy, dx) * (180 / Math.PI)}deg` }] };
  });
  return { points, segments };
}
