// Monte Carlo batch runner - ALL CARDS FACE UP variant
// Usage: node montecarlo-batch-allup.js <startSeed> <count> <timeout> <outputFile>

import { createGameState, cloneState, generateMoves, executeMove, undoMove, isWon, countRemaining } from './js/game.js';
import { getRank, getSuit, isKing, hashState } from './js/utils.js';
import fs from 'fs';

const START_SEED = parseInt(process.argv[2]) || 1;
const COUNT = parseInt(process.argv[3]) || 100;
const TIMEOUT = parseInt(process.argv[4]) || 30000;
const OUTPUT_FILE = process.argv[5] || 'montecarlo-allup-results.json';
const MAX_VISITED = 800000;

// Create a game state with ALL cards face-up
function createAllFaceUpState(seed) {
    const state = createGameState(seed);
    for (const col of state.columns) {
        for (const card of col) {
            card.faceUp = true;
        }
    }
    return state;
}

// ---- Solver (same as normal) ----

function firstFaceUpRow(col) {
    for (let i = 0; i < col.length; i++) { if (col[i].faceUp) return i; }
    return col.length;
}

function orderMovesFast(state, moves) {
    const scored = [];
    for (let m = 0; m < moves.length; m++) {
        const move = moves[m];
        let score = 0;
        if (move.type === 'stock') { scored.push({ move, score: 20 }); continue; }
        const { fromCol, fromRow, toCol } = move;
        const col = state.columns[fromCol];
        if (fromRow > 0 && !col[fromRow - 1].faceUp && fromRow === firstFaceUpRow(col)) score += 100;
        if (fromRow === 0) score += 5;
        const targetCol = state.columns[toCol];
        if (targetCol.length > 0) {
            let seqLen = 1;
            for (let i = fromRow + 1; i < col.length; i++) {
                if (getSuit(col[i].id) === getSuit(col[i - 1].id) && getRank(col[i].id) === getRank(col[i - 1].id) - 1) seqLen++;
                else break;
            }
            score += seqLen * 3;
            const tc = targetCol[targetCol.length - 1];
            if (getRank(tc.id) === 12 && getSuit(tc.id) === getSuit(col[fromRow].id)) score += 10;
            if (targetCol.length >= 2) {
                const ut = targetCol[targetCol.length - 2];
                if (getSuit(ut.id) === getSuit(tc.id) && getRank(ut.id) === getRank(tc.id) + 1) score += 8;
            }
        } else { score -= 5; }
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
        if (nodesExplored % 3000 === 0 && Date.now() - startTime > timeout) { timedOut = true; return false; }
        if (isWon(ws)) return true;
        const hash = hashState(ws.columns, ws.stockDealt);
        if (visited.has(hash)) return false;
        if (!visitedFull) { if (visited.size >= MAX_VISITED) visitedFull = true; else visited.add(hash); }
        const remaining = countRemaining(ws);
        if (remaining < bestRemaining) bestRemaining = remaining;
        if (depth > 80) return false;
        const moves = generateMoves(ws);
        if (moves.length === 0) return false;
        const ordered = orderMovesFast(ws, moves);
        for (let i = 0; i < ordered.length; i++) {
            const move = ordered[i].move;
            if (lastMove && move.type === 'move' && lastMove.type === 'move' &&
                move.fromCol === lastMove.toCol && move.toCol === lastMove.fromCol) continue;
            if (move.type === 'move') {
                const sc = ws.columns[move.fromCol]; const dc = ws.columns[move.toCol];
                if (move.fromRow === 0 && dc.length === 0 && isKing(sc[0].id)) continue;
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
    return { solvable: solved, timedOut, nodesExplored, bestRemaining: solved ? 0 : bestRemaining };
}

// ---- Run batch ----
const batchResults = [];
const batchStart = Date.now();

for (let i = 0; i < COUNT; i++) {
    const seed = START_SEED + i;
    const state = createAllFaceUpState(seed);
    const t0 = Date.now();
    const result = solveFast(state, TIMEOUT);
    const elapsed = Date.now() - t0;

    const outcome = result.solvable ? 'win' : result.timedOut ? 'timeout' : 'loss';
    batchResults.push({ seed, outcome, nodes: result.nodesExplored, time: elapsed, bestRemaining: result.bestRemaining });

    const done = i + 1;
    if (done <= 3 || done % 20 === 0 || done === COUNT) {
        const wins = batchResults.filter(r => r.outcome === 'win').length;
        const losses = batchResults.filter(r => r.outcome === 'loss').length;
        const timeouts = batchResults.filter(r => r.outcome === 'timeout').length;
        const totalTime = ((Date.now() - batchStart) / 1000).toFixed(1);
        process.stdout.write(`\r  [ALL UP] Seeds ${START_SEED}-${START_SEED + COUNT - 1}: ${done}/${COUNT} | ${wins}W/${losses}L/${timeouts}T | ${totalTime}s   `);
    }
}

console.log('');

// Load existing and append
let allResults = [];
if (fs.existsSync(OUTPUT_FILE)) {
    try { allResults = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8')); } catch (e) { allResults = []; }
}
allResults.push(...batchResults);
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults));

const wins = allResults.filter(r => r.outcome === 'win').length;
const losses = allResults.filter(r => r.outcome === 'loss').length;
const timeouts = allResults.filter(r => r.outcome === 'timeout').length;
const total = allResults.length;
console.log(`  Batch complete. Total so far: ${total} games | ${wins}W/${losses}L/${timeouts}T | Win rate: ${(wins/total*100).toFixed(2)}%`);
