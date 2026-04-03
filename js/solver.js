import { getRank, getSuit, isKing, hashState, NUM_COLUMNS } from './utils.js';
import { cloneState, generateMoves, executeMove, undoMove, isWon, countRemaining } from './game.js';

const MAX_VISITED = 800000;
const DEFAULT_TIMEOUT = 30000;

// Score a state: higher = closer to winning
function scoreState(state) {
    let score = 0;
    // Completed runs are worth the most
    score += (52 - state.cardsRemaining) * 200;

    let totalFaceDown = 0;

    for (let c = 0; c < state.columns.length; c++) {
        const col = state.columns[c];
        if (col.length === 0) { score += 5; continue; }

        // Penalize face-down cards
        let faceDownCount = 0;
        for (let r = 0; r < col.length; r++) {
            if (!col[r].faceUp) faceDownCount++;
        }
        score -= faceDownCount * 15;
        totalFaceDown += faceDownCount;

        // Find ALL same-suit sequences in the column (not just from bottom)
        let r = col.length - 1;
        while (r >= 0) {
            if (!col[r].faceUp) { r--; continue; }
            let seqLen = 1;
            let seqStart = r;
            while (seqStart > 0 && col[seqStart - 1].faceUp &&
                   getSuit(col[seqStart - 1].id) === getSuit(col[seqStart].id) &&
                   getRank(col[seqStart - 1].id) === getRank(col[seqStart].id) + 1) {
                seqLen++;
                seqStart--;
            }
            // Value longer sequences more (quadratic bonus)
            score += seqLen * seqLen * 2;

            // Bonus for king-led sequences (closer to a complete run)
            if (col[seqStart].faceUp && getRank(col[seqStart].id) === 12) {
                score += seqLen * 8;
                // Extra bonus if king is at row 0 (top of column)
                if (seqStart === 0) score += seqLen * 4;
            }

            // Bonus for sequences that end with Ace (complete from bottom)
            if (getRank(col[r].id) === 0) {
                score += seqLen * 5;
            }

            r = seqStart - 1;
        }

        // Bonus for columns that are entirely face-up
        if (faceDownCount === 0 && col.length > 0) {
            score += 10;
        }
    }

    // Bonus for having fewer total face-down cards (revealed progress)
    score += (12 - totalFaceDown) * 10;

    // Bonus for having dealt stock (opens up more cards)
    if (state.stockDealt) score += 5;

    return score;
}

export function solve(state, timeout = DEFAULT_TIMEOUT) {
    const startTime = Date.now();
    const winSearchTimeout = Math.floor(timeout * 0.65);
    const visited = new Set();
    let nodesExplored = 0;
    let visitedFull = false;

    let bestResult = {
        solvable: false,
        moves: [],
        bestMoves: [],
        bestRemaining: countRemaining(state),
        bestScore: scoreState(state),
        timedOut: false,
        nodesExplored: 0
    };

    const workingState = cloneState(state);

    function dfs(depth, lastMove, moveStack) {
        nodesExplored++;

        if (nodesExplored % 1000 === 0) {
            if (Date.now() - startTime > winSearchTimeout) {
                bestResult.timedOut = true;
                return false;
            }
            if (typeof postMessage === 'function' && typeof WorkerGlobalScope !== 'undefined') {
                postMessage({ type: 'progress', nodesExplored, depth });
            }
        }

        if (isWon(workingState)) {
            bestResult.solvable = true;
            bestResult.moves = [...moveStack];
            bestResult.bestMoves = [...moveStack];
            bestResult.bestRemaining = 0;
            bestResult.bestScore = Infinity;
            return true;
        }

        // State deduplication
        const hash = hashState(workingState.columns, workingState.stockDealt);
        if (visited.has(hash)) return false;
        if (!visitedFull) {
            if (visited.size >= MAX_VISITED) {
                visitedFull = true;
            } else {
                visited.add(hash);
            }
        }

        // Track best state
        const remaining = countRemaining(workingState);
        const score = scoreState(workingState);

        if (remaining < bestResult.bestRemaining ||
            (remaining === bestResult.bestRemaining && score > bestResult.bestScore) ||
            (remaining === bestResult.bestRemaining && score === bestResult.bestScore && moveStack.length > bestResult.bestMoves.length)) {
            bestResult.bestRemaining = remaining;
            bestResult.bestScore = score;
            bestResult.bestMoves = [...moveStack];
        }

        if (depth > 80) return false;

        const moves = generateMoves(workingState);
        if (moves.length === 0) return false;

        const orderedMoves = orderMoves(workingState, moves, lastMove);

        for (const move of orderedMoves) {
            if (isReverseMove(workingState, move, lastMove)) continue;

            if (move.type === 'move') {
                const srcCol = workingState.columns[move.fromCol];
                const dstCol = workingState.columns[move.toCol];
                if (move.fromRow === 0 && dstCol.length === 0 && isKing(srcCol[0].id)) {
                    continue;
                }
            }

            executeMove(workingState, move);
            moveStack.push(move);

            const found = dfs(depth + 1, move, moveStack);

            moveStack.pop();
            undoMove(workingState);

            if (found) return true;
            if (bestResult.timedOut) return false;
        }

        return false;
    }

    dfs(0, null, []);

    // Phase 2: If no win found, do a dedicated best-path search with fresh state
    if (!bestResult.solvable) {
        const phase2Result = findBestPath(state, timeout - (Date.now() - startTime), bestResult);
        if (phase2Result) {
            bestResult.bestMoves = phase2Result.bestMoves;
            bestResult.bestRemaining = phase2Result.bestRemaining;
            bestResult.bestScore = phase2Result.bestScore;
        }
        bestResult.timedOut = (Date.now() - startTime) >= timeout;
    }

    bestResult.nodesExplored = nodesExplored;

    // Ensure we have at least a fallback first move
    if (bestResult.bestMoves.length === 0) {
        const initialMoves = generateMoves(state);
        const orderedInitial = initialMoves.length > 0 ? orderMoves(state, initialMoves, null) : [];
        if (orderedInitial.length > 0) {
            bestResult.bestMoves = [orderedInitial[0]];
        }
    }

    return bestResult;
}

// Phase 2: Dedicated search for the best non-winning path
// Uses score-lookahead move ordering and a fresh transposition table
function findBestPath(state, timeRemaining, currentBest) {
    if (timeRemaining <= 100) return null;
    const startTime = Date.now();
    const deadline = startTime + timeRemaining;
    const visited = new Set();
    let nodesExplored = 0;

    let bestMoves = currentBest.bestMoves ? [...currentBest.bestMoves] : [];
    let bestRemaining = currentBest.bestRemaining;
    let bestScore = currentBest.bestScore;

    const ws = cloneState(state);

    function dfs(depth, lastMove, moveStack) {
        nodesExplored++;
        if (nodesExplored % 500 === 0 && Date.now() >= deadline) return;

        const remaining = countRemaining(ws);
        const score = scoreState(ws);

        // Update best: prefer fewer remaining, then higher score, then longer path
        if (remaining < bestRemaining ||
            (remaining === bestRemaining && score > bestScore) ||
            (remaining === bestRemaining && score === bestScore && moveStack.length > bestMoves.length)) {
            bestRemaining = remaining;
            bestScore = score;
            bestMoves = [...moveStack];
        }

        if (depth > 60) return;

        const hash = hashState(ws.columns, ws.stockDealt);
        if (visited.has(hash)) return;
        if (visited.size < MAX_VISITED) visited.add(hash);

        const moves = generateMoves(ws);
        if (moves.length === 0) return;

        // Score-lookahead: evaluate each move's resulting state
        const scored = [];
        for (const move of moves) {
            if (isReverseMove(ws, move, lastMove)) continue;
            if (move.type === 'move') {
                const srcCol = ws.columns[move.fromCol];
                const dstCol = ws.columns[move.toCol];
                if (move.fromRow === 0 && dstCol.length === 0 && isKing(srcCol[0].id)) continue;
            }

            executeMove(ws, move);
            const newRemaining = countRemaining(ws);
            const newScore = scoreState(ws);
            undoMove(ws);

            // Composite: prioritize fewer remaining, then higher score
            const composite = (52 - newRemaining) * 10000 + newScore;
            scored.push({ move, composite });
        }

        scored.sort((a, b) => b.composite - a.composite);

        for (const { move } of scored) {
            executeMove(ws, move);
            moveStack.push(move);

            dfs(depth + 1, move, moveStack);

            moveStack.pop();
            undoMove(ws);

            if (Date.now() >= deadline) return;
        }
    }

    dfs(0, null, []);

    if (bestRemaining < currentBest.bestRemaining ||
        (bestRemaining === currentBest.bestRemaining && bestScore > currentBest.bestScore) ||
        (bestRemaining === currentBest.bestRemaining && bestScore === currentBest.bestScore && bestMoves.length > currentBest.bestMoves.length)) {
        return { bestMoves, bestRemaining, bestScore };
    }
    return null;
}

function orderMoves(state, moves, lastMove) {
    const scored = moves.map(move => {
        let score = 0;

        if (move.type === 'stock') {
            score = 20;
            return { move, score };
        }

        const { fromCol, fromRow, toCol } = move;
        const col = state.columns[fromCol];

        // Moves that reveal a face-down card (highest priority)
        if (fromRow > 0 && !col[fromRow - 1].faceUp) {
            if (fromRow === firstFaceUpRow(col)) {
                score += 100;
            }
        }

        // Moving entire column starting at row 0
        if (fromRow === 0) score += 5;

        const targetCol = state.columns[toCol];
        if (targetCol.length > 0) {
            // Count sequential cards being moved
            const movingCards = col.slice(fromRow);
            let seqLen = 1;
            for (let i = 1; i < movingCards.length; i++) {
                if (getSuit(movingCards[i].id) === getSuit(movingCards[i - 1].id) &&
                    getRank(movingCards[i].id) === getRank(movingCards[i - 1].id) - 1) {
                    seqLen++;
                } else break;
            }
            score += seqLen * 3;

            // Building on a king
            const targetCard = targetCol[targetCol.length - 1];
            if (getRank(targetCard.id) === 12 && getSuit(targetCard.id) === getSuit(col[fromRow].id)) {
                score += 10;
            }

            // Check if this extends an existing sequence on target
            if (targetCol.length >= 2) {
                const underTarget = targetCol[targetCol.length - 2];
                if (getSuit(underTarget.id) === getSuit(targetCard.id) &&
                    getRank(underTarget.id) === getRank(targetCard.id) + 1) {
                    score += 8; // Target is already part of a sequence
                }
            }
        }

        if (targetCol.length === 0) score -= 5;

        return { move, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.move);
}

function firstFaceUpRow(col) {
    for (let i = 0; i < col.length; i++) {
        if (col[i].faceUp) return i;
    }
    return col.length;
}

function isReverseMove(state, move, lastMove) {
    if (!lastMove) return false;
    if (move.type === 'stock' || lastMove.type === 'stock') return false;

    // Check if this move sends cards back to where they came from
    if (move.fromCol === lastMove.toCol && move.toCol === lastMove.fromCol) {
        // Check if the card being moved is the same card that was just moved
        const srcCol = state.columns[move.fromCol];
        if (move.fromRow < srcCol.length) {
            const cardBeingMoved = srcCol[move.fromRow].id;
            // The last move moved cards starting from lastMove.fromRow in the source column
            // Those cards are now at the end of the destination (which is move.fromCol)
            // If we're moving them back, it's a reverse
            const lastMovedCount = state.columns[move.fromCol].length - move.fromRow;
            const origSrcLen = state.columns[move.toCol].length + lastMovedCount;
            if (move.fromRow >= origSrcLen - lastMovedCount) {
                return true;
            }
        }
    }
    return false;
}

export { MAX_VISITED, DEFAULT_TIMEOUT };
