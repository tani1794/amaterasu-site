// Chart.js（CDN読み込み・グローバル window.Chart）による市場チャート
let chart = null;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** '#rrggbb' → 'rgba(r,g,b,a)'（canvas のグラデーションは color-mix を解釈できないため） */
function withAlpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export function chartAvailable() {
  return typeof window.Chart === 'function';
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{name:string, unit:string, decimals:number, history:{d:string,c:number}[]}} inst
 * @param {{reduceMotion:boolean}} opts
 */
export function drawMarketChart(canvas, inst, { reduceMotion }) {
  if (!chartAvailable()) return false;
  const points = (inst.history || []).slice(-90);
  const labels = points.map((p) => p.d.slice(5).replace('-', '/'));
  const values = points.map((p) => p.c);
  const rising = values.length > 1 && values.at(-1) >= values[0];
  const line = rising ? cssVar('--up') : cssVar('--down');
  const text = cssVar('--muted');
  const grid = cssVar('--chart-grid');

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 300);
  gradient.addColorStop(0, withAlpha(line, 0.35));
  gradient.addColorStop(1, withAlpha(line, 0));

  chart?.destroy();
  chart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${inst.name}（${inst.unit}）`,
        data: values,
        borderColor: line,
        backgroundColor: gradient,
        fill: true,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion ? false : { duration: 1100, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: text, boxWidth: 12, font: { family: 'Noto Sans JP' } } },
        tooltip: {
          callbacks: {
            label: (c) => `${inst.name}: ${c.parsed.y.toLocaleString('ja-JP', { maximumFractionDigits: inst.decimals + 1 })} ${inst.unit}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: text, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: grid } },
        y: { ticks: { color: text, maxTicksLimit: 6 }, grid: { color: grid } },
      },
    },
  });
  return true;
}
