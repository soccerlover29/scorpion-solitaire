// Monte Carlo simulation for Scorpion Solitaire win percentage
// Run: node montecarlo-cli.js [numGames] [timeoutPerGame]

import { createGameState, cloneState, generateMoves, executeMove, undoMove, isWon, countRemaining } from './js/game.js';
import { getRank, getSuit, isKing, hashState, NUM_COLUMNS } from './js/utils.js';
import fs from 'fs';

const NUM_GAMES = parseInt(process.argv[2]) || 500;
const TIMEOUT_PER_GAME = parseInt(process.argv[3]) || 10000; // 10s default
const MAX_VISITED = 600000;

// ---- Fast deadlock detection ----

function hasBuriedDependency(state) {
    for (let c = 0; c < state.columns.length; c++) {
        const col = state.columns[c];
        for (let r = 0; r < col.length; r++) {
            if (col[r].faceUp) continue;
            const bRank = getRank(col[r].id);
            const bSuit = getSuit(col[r].id);
            if (bRank === 0) continue; // Ace
            for (let a = r + 1; a < col.length; a++) {
                if (getRank(col[a].id) === bRank - 1 && getSuit(col[a].id) === bSuit) {
                    return true;
                }
            }
        }
    }
    return false;
}

// ---- Optimized solver for Monte Carlo (no scoring, no move path tracking) ----

function firstFaceUpRow(col) {
    for (let i = 0; i < col.length; i++) {
        if (col[i].faceUp) return i;
    }
    return col.length;
}

function orderMovesFast(state, moves) {
    const scored = [];
    for (let m = 0; m < moves.length; m++) {
        const move = moves[m];
        let score = 0;
        if (move.type === 'stock') {
            scored.push({ move, score: 20 });
            continue;
        }
        const { fromCol, fromRow, toCol } = move;
        const col = state.columns[fromCol];

        // Revealing a face-down card is highest priority
        if (fromRow > 0 && !col[fromRow - 1].faceUp && fromRow === firstFaceUpRow(col)) {
            score += 100;
        }

        if (fromRow === 0) score += 5;

        const targetCol = state.columns[toCol];
        if (targetCol.length > 0) {
            // Count same-suit sequence length being moved (without creating new array)
            let seqLen = 1;
            for (let i = fromRow + 1; i < col.length; i++) {
                if (getSuit(col[i].id) === getSuit(col[i - 1].id) &&
                    getRank(col[i].id) === getRank(col[i - 1].id) - 1) {
                    seqLen++;
                } else break;
            }
            score += seqLen * 3;

            const targetCard = targetCol[targetCol.length - 1];
            if (getRank(targetCard.id) === 12 && getSuit(targetCard.id) === getSuit(col[fromRow].id)) {
                score += 10;
            }
            if (targetCol.length >= 2) {
                const underTarget = targetCol[targetCol.length - 2];
                if (getSuit(underTarget.id) === getSuit(targetCard.id) &&
                    getRank(underTarget.id) === getRank(targetCard.id) + 1) {
                    score += 8;
                }
            }
        } else {
            score -= 5;
        }
        scored.push({ move, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
}

function solveFast(state, timeout) {
    const startTime = Date.now();
    const visited = new Set();
    let nodesExplored = 0;
    let visitedFull = false;
    let bestRemaining = 52;
    let timedOut = false;

    const ws = cloneState(state);

    function dfs(depth, lastMove) {
        nodesExplored++;

        if (nodesExplored % 3000 === 0) {
            if (Date.now() - startTime > timeout) {
                timedOut = true;
                return false;
            }
        }

        if (isWon(ws)) return true;

        const hash = hashState(ws.columns, ws.stockDealt);
        if (visited.has(hash)) return false;
        if (!visitedFull) {
            if (visited.size >= MAX_VISITED) visitedFull = true;
            else visited.add(hash);
        }

        const remaining = countRemaining(ws);
        if (remaining < bestRemaining) bestRemaining = remaining;

        if (depth > 80) return false;

        const moves = generateMoves(ws);
        if (moves.length === 0) return false;

        const orderedMoves = orderMovesFast(ws, moves);

        for (let i = 0; i < orderedMoves.length; i++) {
            const move = orderedMoves[i].move;

            // Skip reverse of last move
            if (lastMove && move.type === 'move' && lastMove.type === 'move' &&
                move.fromCol === lastMove.toCol && move.toCol === lastMove.fromCol) {
                continue;
            }

            // Skip pointless king moves to empty columns
            if (move.type === 'move') {
                const srcCol = ws.columns[move.fromCol];
                const dstCol = ws.columns[move.toCol];
                if (move.fromRow === 0 && dstCol.length === 0 && isKing(srcCol[0].id)) {
                    continue;
                }
            }

            executeMove(ws, move);
            const found = dfs(depth + 1, move);
            undoMove(ws);

            if (found) return true;
            if (timedOut) return false;
        }

        return false;
    }

    const solved = dfs(0, null);
    return {
        solvable: solved,
        timedOut,
        nodesExplored,
        bestRemaining: solved ? 0 : bestRemaining
    };
}

// ---- Monte Carlo runner ----

console.log(`\nScorpion Solitaire Monte Carlo Simulation`);
console.log(`==========================================`);
console.log(`Games: ${NUM_GAMES} | Timeout per game: ${TIMEOUT_PER_GAME / 1000}s`);
console.log(`Starting...\n`);

let wins = 0;
let losses = 0;
let timeouts = 0;
const winRateHistory = [];
const results = [];

const totalStart = Date.now();

for (let i = 0; i < NUM_GAMES; i++) {
    const seed = i + 1;
    const state = createGameState(seed);
    const gameStart = Date.now();

    const hasDeadlock = hasBuriedDependency(state);
    const result = solveFast(state, TIMEOUT_PER_GAME);
    const elapsed = Date.now() - gameStart;

    if (result.solvable) {
        wins++;
        results.push({ seed, outcome: 'win', nodes: result.nodesExplored, time: elapsed, bestRemaining: 0, deadlock: false });
    } else if (result.timedOut) {
        timeouts++;
        results.push({ seed, outcome: 'timeout', nodes: result.nodesExplored, time: elapsed, bestRemaining: result.bestRemaining, deadlock: hasDeadlock });
    } else {
        losses++;
        results.push({ seed, outcome: 'loss', nodes: result.nodesExplored, time: elapsed, bestRemaining: result.bestRemaining, deadlock: hasDeadlock });
    }

    const total = wins + losses + timeouts;
    const winRate = (wins / total * 100).toFixed(2);
    winRateHistory.push({ game: total, winRate: parseFloat(winRate), wins, losses, timeouts });

    if (total <= 5 || total % 10 === 0 || total === NUM_GAMES) {
        const elapsed_total = ((Date.now() - totalStart) / 1000).toFixed(1);
        const eta = total < NUM_GAMES
            ? ((Date.now() - totalStart) / total * (NUM_GAMES - total) / 1000 / 60).toFixed(1)
            : '0';
        process.stdout.write(
            `\r  Game ${total}/${NUM_GAMES} | Win: ${winRate}% (${wins}W/${losses}L/${timeouts}T) | Time: ${elapsed_total}s | ETA: ${eta}m   `
        );
    }
}

console.log(`\n`);

// ---- Final results ----
const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
const finalWinRate = (wins / NUM_GAMES * 100).toFixed(2);
const winRateExcludingTimeouts = losses + wins > 0
    ? (wins / (wins + losses) * 100).toFixed(2)
    : 'N/A';

const deadlockCount = results.filter(r => r.deadlock).length;

// 95% confidence interval
const p = wins / NUM_GAMES;
const n = NUM_GAMES;
const z = 1.96;
const ciLow = Math.max(0, (p - z * Math.sqrt(p * (1 - p) / n)) * 100).toFixed(2);
const ciHigh = Math.min(100, (p + z * Math.sqrt(p * (1 - p) / n)) * 100).toFixed(2);

console.log(`RESULTS`);
console.log(`=======`);
console.log(`Total games:           ${NUM_GAMES}`);
console.log(`Wins (solvable):       ${wins}`);
console.log(`Losses (proven):       ${losses}`);
console.log(`  - Deadlocked:        ${deadlockCount}`);
console.log(`Timeouts:              ${timeouts}`);
console.log(`Win rate:              ${finalWinRate}% (${ciLow}% - ${ciHigh}% at 95% CI)`);
console.log(`Win rate (excl. TO):   ${winRateExcludingTimeouts}%`);
console.log(`Total time:            ${totalElapsed}s`);
console.log(`Avg time/game:         ${(parseFloat(totalElapsed) / NUM_GAMES).toFixed(2)}s`);

// Remaining distribution
const remainingDist = {};
for (const r of results) {
    if (r.outcome !== 'win') {
        const bucket = r.bestRemaining;
        remainingDist[bucket] = (remainingDist[bucket] || 0) + 1;
    }
}
console.log(`\nBest remaining cards distribution (non-wins):`);
const sortedBuckets = Object.keys(remainingDist).map(Number).sort((a, b) => a - b);
for (const bucket of sortedBuckets) {
    const pct = (remainingDist[bucket] / (losses + timeouts) * 100).toFixed(1);
    console.log(`  ${String(bucket).padStart(2)} cards: ${String(remainingDist[bucket]).padStart(4)} games (${pct}%)`);
}

// ---- Generate HTML graph ----
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
</style>
</head>
<body>
<h1>Scorpion Solitaire - Monte Carlo Results</h1>
<p>Simulation of ${NUM_GAMES} random games with ${TIMEOUT_PER_GAME / 1000}s solver timeout per game.</p>

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
    <div class="sub">${deadlockCount} deadlocked</div>
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
  <h2>Win Rate Over Iterations</h2>
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

<script>
const data = ${graphData};
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');

const dpr = window.devicePixelRatio || 1;
const rect = canvas.getBoundingClientRect();
canvas.width = rect.width * dpr;
canvas.height = 400 * dpr;
ctx.scale(dpr, dpr);
const W = rect.width;
const H = 400;

const pad = { top: 30, right: 40, bottom: 50, left: 60 };
const plotW = W - pad.left - pad.right;
const plotH = H - pad.top - pad.bottom;

const rates = data.map(d => d.winRate);
const maxRate = Math.max(Math.ceil(Math.max(...rates) * 1.2 / 5) * 5, 15);
const minRate = 0;

function xPos(i) { return pad.left + (i / (data.length - 1)) * plotW; }
function yPos(rate) { return pad.top + plotH - ((rate - minRate) / (maxRate - minRate)) * plotH; }

// Grid
ctx.strokeStyle = '#eee';
ctx.lineWidth = 1;
for (let r = 0; r <= maxRate; r += 5) {
  const y = yPos(r);
  ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
}

// Axes
ctx.strokeStyle = '#999';
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, H - pad.bottom); ctx.lineTo(W - pad.right, H - pad.bottom);
ctx.stroke();

// Y labels
ctx.fillStyle = '#666';
ctx.font = '12px system-ui';
ctx.textAlign = 'right';
for (let r = 0; r <= maxRate; r += 5) {
  ctx.fillText(r + '%', pad.left - 8, yPos(r) + 4);
}

// X labels
ctx.textAlign = 'center';
const xStep = Math.max(1, Math.floor(data.length / 8));
for (let i = 0; i < data.length; i += xStep) {
  ctx.fillText(data[i].game, xPos(i), H - pad.bottom + 20);
}
if (data.length > 1) ctx.fillText(data[data.length-1].game, xPos(data.length-1), H - pad.bottom + 20);
ctx.fillText('Games', W / 2, H - 8);

// Y axis label
ctx.save(); ctx.translate(15, H / 2); ctx.rotate(-Math.PI / 2);
ctx.fillText('Win Rate (%)', 0, 0); ctx.restore();

// Filled area
ctx.fillStyle = 'rgba(26, 107, 60, 0.1)';
ctx.beginPath();
ctx.moveTo(xPos(0), yPos(0));
for (let i = 0; i < data.length; i++) ctx.lineTo(xPos(i), yPos(data[i].winRate));
ctx.lineTo(xPos(data.length - 1), yPos(0));
ctx.closePath();
ctx.fill();

// Line
ctx.strokeStyle = '#1a6b3c';
ctx.lineWidth = 2;
ctx.beginPath();
for (let i = 0; i < data.length; i++) {
  const x = xPos(i); const y = yPos(data[i].winRate);
  if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
}
ctx.stroke();

// Final value
if (data.length > 0) {
  const last = data[data.length - 1];
  ctx.fillStyle = '#1a6b3c';
  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(last.winRate + '%', xPos(data.length - 1) + 8, yPos(last.winRate) - 8);

  // Dot
  ctx.beginPath();
  ctx.arc(xPos(data.length - 1), yPos(last.winRate), 4, 0, Math.PI * 2);
  ctx.fillStyle = '#1a6b3c';
  ctx.fill();
}
</script>
</body>
</html>`;

fs.writeFileSync('montecarlo-results.html', html);
console.log(`\nGraph saved to montecarlo-results.html`);

fs.writeFileSync('montecarlo-results.json', JSON.stringify({
    config: { numGames: NUM_GAMES, timeoutPerGame: TIMEOUT_PER_GAME },
    summary: { wins, losses, timeouts, winRate: finalWinRate, ciLow, ciHigh, deadlockCount },
    winRateHistory,
    results
}, null, 2));
console.log(`Raw data saved to montecarlo-results.json`);
