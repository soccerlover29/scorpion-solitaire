import { createGameState, cloneState, isWon } from './game.js';
import { initRenderer, renderState, setStatusBanner } from './renderer.js';
import { initInput, updateInputState, getSelection, getHint, setHint, clearSelection, doUndo } from './input.js';

let state = null;
let solverWorker = null;
let solving = false;
let solveStartMoveCount = 0;

// Full solution path tracking
let solutionMoves = [];   // The full move sequence from solver
let solutionIndex = 0;    // Current position in the sequence

function newGame(seed) {
    state = createGameState(seed);
    updateInputState(state);
    clearSolverState();
    clearSolution();
    renderState(state, null, null);
    setStatusBanner('', '');
    updateMoveCounter();
    document.body.classList.remove('won');
}

function clearSolution() {
    solutionMoves = [];
    solutionIndex = 0;
    setHint(null);
}

function clearSolverState() {
    if (solverWorker) {
        solverWorker.terminate();
        solverWorker = null;
    }
    solving = false;
    document.getElementById('btn-solve').classList.remove('solving');
    document.getElementById('btn-solve').textContent = 'Solve';
}

function showCurrentHint() {
    if (solutionIndex < solutionMoves.length) {
        const move = solutionMoves[solutionIndex];
        // Validate the hint against current state
        if (move.type === 'stock') {
            if (!state.stockDealt) {
                setHint(move);
                return;
            }
        } else if (move.fromCol < state.columns.length &&
                   move.fromRow < state.columns[move.fromCol].length &&
                   state.columns[move.fromCol][move.fromRow].faceUp) {
            setHint(move);
            return;
        }
        // Hint is invalid for current state — solution is stale
        clearSolution();
    } else {
        setHint(null);
    }
}

function movesMatch(userMove, hintMove) {
    if (userMove.type !== hintMove.type) return false;
    if (userMove.type === 'stock') return true;
    return userMove.fromCol === hintMove.fromCol &&
           userMove.fromRow === hintMove.fromRow &&
           userMove.toCol === hintMove.toCol;
}

function onMoveMade(move) {
    if (move.type === 'undo') {
        // Step back in solution if possible
        if (solutionIndex > 0) {
            solutionIndex--;
            showCurrentHint();
        } else {
            clearSolution();
        }
        return;
    }

    if (solutionMoves.length > 0 && solutionIndex < solutionMoves.length) {
        const expectedMove = solutionMoves[solutionIndex];
        if (movesMatch(move, expectedMove)) {
            // User followed the hint — advance to next
            solutionIndex++;
            showCurrentHint();
        } else {
            // User deviated — invalidate solution
            clearSolution();
        }
    }
}

function onStateChange() {
    renderState(state, getSelection(), getHint());
    updateMoveCounter();
    updateStepCounter();
}

function onWin() {
    clearSolution();
    renderState(state, null, null);
    setStatusBanner('You Win!', 'won');
    document.body.classList.add('won');
    updateMoveCounter();
}

function updateMoveCounter() {
    const counter = document.getElementById('move-counter');
    if (counter) {
        counter.textContent = `Moves: ${state.moveHistory.length}`;
    }
}

function updateStepCounter() {
    const el = document.getElementById('step-counter');
    if (el) {
        if (solutionMoves.length > 0) {
            el.textContent = `Hint: ${solutionIndex + 1}/${solutionMoves.length}`;
        } else {
            el.textContent = '';
        }
    }
}

function startSolver() {
    if (solving) {
        clearSolverState();
        clearSolution();
        setStatusBanner('Solve cancelled', '');
        renderState(state, getSelection(), null);
        return;
    }

    if (isWon(state)) return;

    solving = true;
    solveStartMoveCount = state.moveHistory.length;
    clearSolution();
    const solveBtn = document.getElementById('btn-solve');
    solveBtn.classList.add('solving');
    solveBtn.textContent = 'Cancel';
    setStatusBanner('Solving...', 'solving');

    const solverState = cloneState(state);

    try {
        solverWorker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
        console.warn('Worker failed, running solver on main thread:', e);
        runSolverMainThread(solverState);
        return;
    }

    solverWorker.onmessage = function (e) {
        if (e.data.type === 'progress') {
            setStatusBanner(`Solving... (${e.data.nodesExplored.toLocaleString()} states explored)`, 'solving');
        } else if (e.data.type === 'result') {
            handleSolverResult(e.data);
        } else if (e.data.type === 'error') {
            solving = false;
            solveBtn.classList.remove('solving');
            solveBtn.textContent = 'Solve';
            setStatusBanner(`Solver error: ${e.data.message}`, 'unsolvable');
        }
    };

    solverWorker.onerror = function (e) {
        console.warn('Worker error, falling back to main thread:', e);
        if (solverWorker) {
            solverWorker.terminate();
            solverWorker = null;
        }
        runSolverMainThread(solverState);
    };

    solverWorker.postMessage({ type: 'solve', state: solverState, timeout: 30000 });
}

async function runSolverMainThread(solverState) {
    const { solve } = await import('./solver.js');
    setStatusBanner('Solving on main thread (may freeze briefly)...', 'solving');
    setTimeout(() => {
        const result = solve(solverState, 30000);
        handleSolverResult(result);
    }, 50);
}

function handleSolverResult(result) {
    solving = false;
    const solveBtn = document.getElementById('btn-solve');
    solveBtn.classList.remove('solving');
    solveBtn.textContent = 'Solve';

    const stateChanged = state.moveHistory.length !== solveStartMoveCount;
    const hintMoves = result.solvable ? result.moves : result.bestMoves;

    if (result.solvable) {
        setStatusBanner(
            `Solvable! (${result.moves.length} moves, ${result.nodesExplored.toLocaleString()} states explored)`,
            'solvable'
        );
    } else if (result.timedOut) {
        const msg = result.bestRemaining < 52
            ? `Timed out - best path found: ${result.bestRemaining} cards remaining (${hintMoves.length} moves)`
            : `Timed out after exploring ${result.nodesExplored.toLocaleString()} states`;
        setStatusBanner(msg, 'unsolvable');
    } else {
        setStatusBanner(
            `Not solvable - best achievable: ${result.bestRemaining} cards remaining (${hintMoves.length} moves)`,
            'unsolvable'
        );
    }

    // Store full solution path and show first hint
    if (!stateChanged && hintMoves && hintMoves.length > 0) {
        solutionMoves = hintMoves;
        solutionIndex = 0;
        showCurrentHint();
    }

    renderState(state, getSelection(), getHint());
    updateStepCounter();
}

function init() {
    initRenderer();
    newGame();
    initInput(state, { onStateChange, onWin, onMoveMade });

    document.getElementById('btn-new').addEventListener('click', () => {
        newGame();
        updateInputState(state);
        initInput(state, { onStateChange, onWin, onMoveMade });
    });

    document.getElementById('btn-undo').addEventListener('click', doUndo);
    document.getElementById('btn-solve').addEventListener('click', startSolver);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
            newGame();
            updateInputState(state);
            initInput(state, { onStateChange, onWin, onMoveMade });
        } else if (e.key === 'u' || (e.ctrlKey && e.key === 'z')) {
            doUndo();
        } else if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
            startSolver();
        } else if (e.key === 'Escape') {
            clearSelection();
            onStateChange();
        }
    });
}

document.addEventListener('DOMContentLoaded', init);
