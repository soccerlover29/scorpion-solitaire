import { getRank, getSuit, isKing, hashState, NUM_COLUMNS } from './utils.js';
import { cloneState, generateMoves, executeMove, undoMove, isWon, countRemaining } from './game.js';

const MAX_VISITED = 800000;
const DEFAULT_TIMEOUT = 30000;

// Score a state: higher = closer to winning
function scoreState(state) {
    let score = 0;
    score += (52 - state.cardsRemaining) * 100;

    for (let c = 0; c < state.columns.length; c++) {
        const col = state.columns[c];
        if (col.length === 0) continue;

        for (let r = 0; r < col.length; r++) {
            if (!col[r].faceUp) score -= 10;
        }

        // Count same-suit sequences from bottom
        let seqLen = 1;
        for (let r = col.length - 2; r >= 0; r--) {
            if (!col[r].faceUp) break;
            if (getSuit(col[r].id) === getSuit(col[r + 1].id) &&
                getRank(col[r].id) === getRank(col[r + 1].id) + 1) {
                seqLen++;
            } else break;
        }
        score += seqLen * 5;
        if (col.length > 0 && col[0].faceUp && getRank(col[0].id) === 12) {
            score += seqLen * 3;
        }
    }
    return score;
}

export function solve(state, timeout = DEFAULT_TIMEOUT) {
    const startTime = Date.now();
    const visited = new Set();
    let nodesExplored = 0;
    let visitedFull = false;

    // Pre-compute the recommended first move from initial state
    const initialMoves = generateMoves(state);
    const orderedInitial = initialMoves.length > 0 ? orderMoves(state, initialMoves, null) : [];
    const fallbackFirstMove = orderedInitial.length > 0 ? orderedInitial[0] : null;

    let bestResult = {
        solvable: false,
        moves: [],
        bestMoves: fallbackFirstMove ? [fallbackFirstMove] : [],
        bestRemaining: countRemaining(state),
        bestScore: scoreState(state),
        timedOut: false,
        nodesExplored: 0
    };

    const workingState = cloneState(state);

    function dfs(depth, lastMove, moveStack) {
        nodesExplored++;

        if (nodesExplored % 1000 === 0) {
            if (Date.now() - startTime > timeout) {
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

        // State deduplication — check even if set is full, just don't add new entries
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
            (remaining <= bestResult.bestRemaining && score > bestResult.bestScore)) {
            bestResult.bestRemaining = remaining;
            bestResult.bestScore = score;
            bestResult.bestMoves = [...moveStack];
        }

        if (depth > 80) return false;

        const moves = generateMoves(workingState);
        if (moves.length === 0) return false;

        const orderedMoves = orderMoves(workingState, moves, lastMove);

        for (const move of orderedMoves) {
            // Skip reverse of last move (check by card identity)
            if (isReverseMove(workingState, move, lastMove)) continue;

            // Skip pointless moves: moving a group that's already in sequence
            // on a king from one empty col to another empty col
            if (move.type === 'move') {
                const srcCol = workingState.columns[move.fromCol];
                const dstCol = workingState.columns[move.toCol];
                // Don't move a king from top of column to empty column (no progress)
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
    bestResult.nodesExplored = nodesExplored;
    return bestResult;
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
