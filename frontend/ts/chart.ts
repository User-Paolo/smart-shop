import type { ForecastPoint, ForecastProduct, RiskLevel, SalesPoint } from './types.js';

interface Ctx2D {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function setup(canvas: HTMLCanvasElement, height: number): Ctx2D {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
  return { ctx, width, height };
}

function niceNum(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function niceScale(dataMax: number, integer = true): { max: number; step: number } {
  let step = niceNum(Math.max(dataMax, 1) / 4);
  if (integer) step = Math.max(1, Math.round(step));
  return { max: Math.ceil(Math.max(dataMax, 1) / step) * step, step };
}

function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, Math.abs(h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

const shortDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

// One product: 30 days of sales, then the 7 day forecast with a trend line
export function drawDemandChart(
  canvas: HTMLCanvasElement,
  history: SalesPoint[],
  forecast: ForecastPoint[],
  chartHeight = 280,
): void {
  const { ctx, width, height } = setup(canvas, chartHeight);
  const pad = { top: 18, right: 16, bottom: 34, left: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Days without sales count as zero
  const byDate = new Map(history.map((p) => [p.date, p.units]));
  const firstForecast = forecast[0]?.date ?? new Date().toISOString().slice(0, 10);
  const start = new Date(`${firstForecast}T00:00:00`);
  const actual: { date: string; value: number }[] = [];
  for (let i = 30; i >= 1; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    actual.push({ date: key, value: byDate.get(key) ?? 0 });
  }
  const predicted = forecast.map((p) => ({ date: p.date, value: p.predicted }));
  const all = [...actual, ...predicted];

  const { max: yMax, step: yStep } = niceScale(Math.max(...all.map((p) => p.value)) * 1.05);
  const slot = plotW / all.length;
  const barW = Math.max(2, slot * 0.68);
  const y = (v: number): number => pad.top + plotH - (v / yMax) * plotH;

  // Grid and y axis labels
  ctx.strokeStyle = css('--grid');
  ctx.fillStyle = css('--text-muted');
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
    ctx.stroke();
    ctx.fillText(Number.isInteger(v) ? String(v) : v.toFixed(1), pad.left - 6, yy);
  }

  // Forecast zone background
  const splitX = pad.left + actual.length * slot;
  ctx.fillStyle = css('--chart-forecast-zone');
  ctx.fillRect(splitX, pad.top, width - pad.right - splitX, plotH);

  // Bars
  all.forEach((p, i) => {
    const isForecast = i >= actual.length;
    ctx.fillStyle = css(isForecast ? '--chart-forecast' : '--chart-actual');
    const x = pad.left + i * slot + (slot - barW) / 2;
    const top = y(p.value);
    if (p.value > 0) roundedBar(ctx, x, top, barW, pad.top + plotH - top, 3);
  });

  // Forecast trend line over the predicted bars
  if (predicted.length > 1) {
    ctx.strokeStyle = css('--chart-forecast-line');
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    predicted.forEach((p, j) => {
      const cx = pad.left + (actual.length + j) * slot + slot / 2;
      j === 0 ? ctx.moveTo(cx, y(p.value)) : ctx.lineTo(cx, y(p.value));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Today marker
  ctx.strokeStyle = css('--text-muted');
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(splitX + 0.5, pad.top);
  ctx.lineTo(splitX + 0.5, pad.top + plotH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css('--text-muted');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('forecast →', splitX + 6, pad.top + 2);

  // X labels step back from the last day so they never overlap
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelEvery = Math.max(1, Math.ceil(56 / slot));
  for (let i = all.length - 1; i >= 0; i -= labelEvery) {
    const point = all[i];
    if (point) ctx.fillText(shortDate(point.date), pad.left + i * slot + slot / 2, pad.top + plotH + 8);
  }
}

// Every product: predicted demand bar against a tick at current stock
export function drawRiskOverview(canvas: HTMLCanvasElement, products: ForecastProduct[]): void {
  const rowH = 26;
  const height = Math.max(120, products.length * rowH + 44);
  const { ctx, width } = setup(canvas, height);

  const labelW = Math.min(190, width * 0.36);
  const pad = { top: 8, right: 56, bottom: 30, left: labelW + 12 };
  const plotW = width - pad.left - pad.right;
  const { max: xMax, step: xStep } = niceScale(Math.max(...products.flatMap((p) => [p.predicted_7d, p.stock])) * 1.05);
  const x = (v: number): number => pad.left + (v / xMax) * plotW;
  const plotBottom = pad.top + products.length * rowH;

  const riskColor: Record<RiskLevel, string> = {
    high: css('--risk-high'),
    medium: css('--risk-medium'),
    low: css('--risk-low'),
  };

  // Grid and x labels
  ctx.strokeStyle = css('--grid');
  ctx.fillStyle = css('--text-muted');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let v = 0; v <= xMax + 1e-9; v += xStep) {
    const xx = Math.round(x(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(xx, pad.top);
    ctx.lineTo(xx, plotBottom);
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), xx, plotBottom + 8);
  }

  products.forEach((p, i) => {
    const cy = pad.top + i * rowH + rowH / 2;

    // Product label
    ctx.fillStyle = css('--text');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    let label = p.name;
    while (ctx.measureText(label).width > labelW - 4 && label.length > 4) label = `${label.slice(0, -2)}…`;
    ctx.fillText(label, pad.left - 10, cy);

    // Demand bar
    ctx.fillStyle = riskColor[p.risk];
    const barH = 12;
    const w = Math.max(2, x(p.predicted_7d) - pad.left);
    ctx.beginPath();
    ctx.roundRect(pad.left, cy - barH / 2, w, barH, 3);
    ctx.fill();

    // Stock marker
    const sx = Math.round(x(p.stock)) + 0.5;
    ctx.strokeStyle = css('--text');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, cy - 9);
    ctx.lineTo(sx, cy + 9);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Value label
    ctx.fillStyle = css('--text-muted');
    ctx.textAlign = 'left';
    ctx.fillText(p.predicted_7d.toFixed(0), Math.max(x(p.predicted_7d), sx) + 6, cy);
  });
}
