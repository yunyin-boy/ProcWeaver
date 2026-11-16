// ==========================================================================
// ProcWeaver src-next 60 点滑动窗口三次贝塞尔光滑波形算法
// 规范溯源: tauri-linear-raycast-ui (高精度数据可视化)
// 特性: 动态自适应顶线标尺 (支持 10Gbps 顶线) 与贝塞尔平滑渲染
// ==========================================================================

export interface WaveSvgResult {
  pathD: string;
  areaD: string;
  lastY: number;
}

/**
 * 根据 60 个历史采样点生成高精度光滑贝塞尔曲线路径
 * @param history 历史数值采样数组（如 bps 或 MB/s）
 * @param maxHeight SVG 视口高度（默认 100）
 * @param ceilingValue 当前波形图动态顶线基准（默认至少 1,000,000 即 1 Mbps）
 */
export function generateSvgWave(
  history: number[],
  maxHeight: number = 100,
  ceilingValue: number = 1_000_000
): WaveSvgResult {
  const effectiveCeiling = Math.max(ceilingValue, ...history, 1);
  const total = history.length;

  if (total < 2) {
    return {
      pathD: `M 0,${maxHeight} L 1000,${maxHeight}`,
      areaD: `M 0,${maxHeight} L 1000,${maxHeight} Z`,
      lastY: maxHeight,
    };
  }

  // 预留顶部 15% 呼吸空间，避免顶格波形被 SVG 边框生硬截断
  const drawableHeight = maxHeight * 0.85;

  const points = history.map((val, idx) => {
    const x = (idx / (total - 1)) * 1000;
    const clampedVal = Math.max(0, val);
    const ratio = Math.min(1, clampedVal / effectiveCeiling);
    const y = maxHeight - ratio * drawableHeight;
    return { x, y };
  });

  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const cx = ((prev.x + cur.x) / 2).toFixed(1);
    const cy = ((prev.y + cur.y) / 2).toFixed(1);
    d += ` Q ${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${cx},${cy}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)},${last.y.toFixed(1)}`;

  const areaD = `${d} L 1000,${maxHeight} L 0,${maxHeight} Z`;

  return {
    pathD: d,
    areaD,
    lastY: last.y,
  };
}
