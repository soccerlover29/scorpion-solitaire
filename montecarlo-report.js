// Generate the Monte Carlo results HTML report from batch results
// Usage: node montecarlo-report.js [inputFile]

import fs from 'fs';

const INPUT_FILE = process.argv[2] || 'montecarlo-batch-results.json';
const results = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));

const NUM_GAMES = results.length;
const wins = results.filter(r => r.outcome === 'win').length;
const losses = results.filter(r => r.outcome === 'loss').length;
const timeouts = results.filter(r => r.outcome === 'timeout').length;
const finalWinRate = (wins / NUM_GAMES * 100).toFixed(2);
const winRateExcludingTimeouts = wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(2) : 'N/A';

// Confidence interval
const p = wins / NUM_GAMES;
const z = 1.96;
const ciLow = Math.max(0, (p - z * Math.sqrt(p * (1 - p) / NUM_GAMES)) * 100).toFixed(2);
const ciHigh = Math.min(100, (p + z * Math.sqrt(p * (1 - p) / NUM_GAMES)) * 100).toFixed(2);

// Win rate history
const winRateHistory = [];
let w = 0, l = 0, t = 0;
for (let i = 0; i < results.length; i++) {
    if (results[i].outcome === 'win') w++;
    else if (results[i].outcome === 'loss') l++;
    else t++;
    winRateHistory.push({ game: i + 1, winRate: parseFloat((w / (i + 1) * 100).toFixed(2)), wins: w, losses: l, timeouts: t });
}

// Remaining distribution
const remainingDist = {};
for (const r of results) {
    if (r.outcome !== 'win') {
        remainingDist[r.bestRemaining] = (remainingDist[r.bestRemaining] || 0) + 1;
    }
}
const sortedBuckets = Object.keys(remainingDist).map(Number).sort((a, b) => a - b);

// Timing stats
const avgTime = (results.reduce((s, r) => s + r.time, 0) / NUM_GAMES / 1000).toFixed(2);
const totalTime = (results.reduce((s, r) => s + r.time, 0) / 1000).toFixed(0);

console.log(`\nRESULTS (${NUM_GAMES} games)`);
console.log(`========================`);
console.log(`Win rate:            ${finalWinRate}% (${ciLow}% - ${ciHigh}% at 95% CI)`);
console.log(`Wins:                ${wins}`);
console.log(`Proven losses:       ${losses}`);
console.log(`Timeouts:            ${timeouts}`);
console.log(`Win % (excl TO):     ${winRateExcludingTimeouts}%`);
console.log(`Avg time/game:       ${avgTime}s`);
console.log(`Total compute time:  ${totalTime}s`);

console.log(`\nCards remaining distribution (non-wins):`);
for (const b of sortedBuckets) {
    const count = remainingDist[b];
    console.log(`  ${String(b).padStart(2)} cards: ${String(count).padStart(4)} (${(count / (losses + timeouts) * 100).toFixed(1)}%)`);
}

// Generate HTML
const graphData = JSON.stringify(winRateHistory);
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scorpion Solitaire - Monte Carlo Results</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #f5f5f5; color: #333; }
  h1 { color: #1a6b3c; }
  h2 { color: #444; margin-top: 30px; }
  p.desc { color: #666; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }
  .stat-card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .stat-card .label { font-size: 12px; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 28px; font-weight: 700; color: #1a6b3c; }
  .stat-card .value.red { color: #d32f2f; }
  .stat-card .value.orange { color: #e67e22; }
  .stat-card .sub { font-size: 11px; color: #999; margin-top: 2px; }
  canvas { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); width: 100%; }
  .chart-container { margin: 30px 0; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 15px 0; }
  th { background: #1a6b3c; color: white; padding: 10px; text-align: left; font-size: 13px; }
  td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 13px; }
  tr:nth-child(even) { background: #fafafa; }
  .bar { height: 16px; background: #1a6b3c; border-radius: 3px; display: inline-block; vertical-align: middle; }
  .method { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 15px 0; font-size: 14px; line-height: 1.6; }
  .method h3 { margin-top: 0; color: #1a6b3c; }
</style>
</head>
<body>
<h1>Scorpion Solitaire - Monte Carlo Simulation</h1>
<p class="desc">Simulation of <strong>${NUM_GAMES}</strong> random deals analyzed with a DFS solver (30s timeout per game, "Thoughtful" mode where all cards are visible to the solver).</p>

<div class="stats">
  <div class="stat-card">
    <div class="label">Win Rate</div>
    <div class="value">${finalWinRate}%</div>
    <div class="sub">95% CI: ${ciLow}% - ${ciHigh}%</div>
  </div>
  <div class="stat-card">
    <div class="label">Games</div>
    <div class="value">${NUM_GAMES}</div>
  </div>
  <div class="stat-card">
    <div class="label">Wins</div>
    <div class="value">${wins}</div>
  </div>
  <div class="stat-card">
    <div class="label">Proven Losses</div>
    <div class="value red">${losses}</div>
  </div>
  <div class="stat-card">
    <div class="label">Timeouts</div>
    <div class="value orange">${timeouts}</div>
    <div class="sub">Possibly solvable</div>
  </div>
  <div class="stat-card">
    <div class="label">Win % (excl TO)</div>
    <div class="value">${winRateExcludingTimeouts}%</div>
  </div>
</div>

<div class="chart-container">
  <h2>Win Rate Convergence</h2>
  <canvas id="chart" height="400"></canvas>
</div>

<h2>Cards Remaining Distribution (Non-Wins)</h2>
<table>
  <tr><th>Cards Left</th><th>Count</th><th>%</th><th>Distribution</th></tr>
  ${sortedBuckets.map(b => {
    const count = remainingDist[b];
    const pct = (count / (losses + timeouts) * 100).toFixed(1);
    const barW = Math.max(2, parseFloat(pct) * 3);
    return `<tr><td>${b}</td><td>${count}</td><td>${pct}%</td><td><span class="bar" style="width:${barW}px"></span></td></tr>`;
  }).join('\n  ')}
</table>

<div class="method">
  <h3>Methodology</h3>
  <p><strong>Solver:</strong> Depth-first search with transposition table (800K states), move ordering heuristics, reverse-move elimination, and 80-move depth limit. Operates in "Thoughtful" mode (all cards visible including face-down).</p>
  <p><strong>Timeout:</strong> 30 seconds per game. Games that timeout are counted separately — they may be solvable with more compute time.</p>
  <p><strong>Seeds:</strong> Deterministic PRNG seeds 1-${NUM_GAMES} for reproducibility.</p>
  <p><strong>Lower bound:</strong> The win rate of ${finalWinRate}% is a lower bound on true solvability, since some timed-out games may be solvable.</p>
</div>

<script>
const data = ${graphData};
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
const rect = canvas.getBoundingClientRect();
canvas.width = rect.width * dpr;
canvas.height = 400 * dpr;
ctx.scale(dpr, dpr);
const W = rect.width, H = 400;
const pad = { top: 30, right: 40, bottom: 50, left: 60 };
const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;
const rates = data.map(d => d.winRate);
const maxRate = Math.max(Math.ceil(Math.max(...rates) * 1.3 / 5) * 5, 20);
function xPos(i) { return pad.left + (i / Math.max(1, data.length - 1)) * plotW; }
function yPos(r) { return pad.top + plotH - (r / maxRate) * plotH; }

// Grid
ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
for (let r = 0; r <= maxRate; r += 5) { ctx.beginPath(); ctx.moveTo(pad.left, yPos(r)); ctx.lineTo(W - pad.right, yPos(r)); ctx.stroke(); }

// Axes
ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5;
ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, H - pad.bottom); ctx.lineTo(W - pad.right, H - pad.bottom); ctx.stroke();

// Y labels
ctx.fillStyle = '#666'; ctx.font = '12px system-ui'; ctx.textAlign = 'right';
for (let r = 0; r <= maxRate; r += 5) ctx.fillText(r + '%', pad.left - 8, yPos(r) + 4);

// X labels
ctx.textAlign = 'center';
const xStep = Math.max(1, Math.floor(data.length / 8));
for (let i = 0; i < data.length; i += xStep) ctx.fillText(data[i].game, xPos(i), H - pad.bottom + 20);
if (data.length > 1) ctx.fillText(data[data.length-1].game, xPos(data.length-1), H - pad.bottom + 20);
ctx.fillText('Games', W / 2, H - 8);
ctx.save(); ctx.translate(15, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Win Rate (%)', 0, 0); ctx.restore();

// Area fill
ctx.fillStyle = 'rgba(26, 107, 60, 0.08)';
ctx.beginPath(); ctx.moveTo(xPos(0), yPos(0));
for (let i = 0; i < data.length; i++) ctx.lineTo(xPos(i), yPos(data[i].winRate));
ctx.lineTo(xPos(data.length - 1), yPos(0)); ctx.closePath(); ctx.fill();

// Line
ctx.strokeStyle = '#1a6b3c'; ctx.lineWidth = 2; ctx.beginPath();
for (let i = 0; i < data.length; i++) { if (i === 0) ctx.moveTo(xPos(i), yPos(data[i].winRate)); else ctx.lineTo(xPos(i), yPos(data[i].winRate)); }
ctx.stroke();

// Final label
if (data.length > 0) {
  const last = data[data.length - 1];
  ctx.fillStyle = '#1a6b3c'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(last.winRate + '%', xPos(data.length - 1) + 8, yPos(last.winRate) - 8);
  ctx.beginPath(); ctx.arc(xPos(data.length - 1), yPos(last.winRate), 4, 0, Math.PI * 2); ctx.fill();
}
</script>
</body>
</html>`;

fs.writeFileSync('montecarlo-results.html', html);
console.log(`\nReport saved to montecarlo-results.html`);
