import { isLegalMove, executeMove, undoMove, isWon } from './game.js';
import { getRank, isKing } from './utils.js';

let state = null;
let selection = null;
let onStateChange = null;
let onWin = null;
let onMoveMade = null;
let hintMove = null;

export function initInput(gameState, callbacks) {
    state = gameState;
    selection = null;
    hintMove = null;
    onStateChange = callbacks.onStateChange;
    onWin = callbacks.onWin;
    onMoveMade = callbacks.onMoveMade || null;

    document.getElementById('tableau').addEventListener('click', handleTableauClick);
    document.getElementById('stock-area').addEventListener('click', handleStockClick);
}

export function updateInputState(gameState) {
    state = gameState;
    selection = null;
    hintMove = null;
}

export function getSelection() {
    return selection;
}

export function getHint() {
    return hintMove;
}

export function setHint(move) {
    hintMove = move;
}

export function clearSelection() {
    selection = null;
}

function handleTableauClick(e) {
    const cardEl = e.target.closest('.card');
    const colEl = e.target.closest('.column');
    if (!colEl) return;

    const col = parseInt(colEl.dataset.col);

    // Clicking empty column
    if (!cardEl) {
        if (selection && state.columns[col].length === 0) {
            const srcCard = state.columns[selection.col][selection.row];
            if (isKing(srcCard.id)) {
                doMove(selection.col, selection.row, col);
                return;
            }
        }
        selection = null;
        onStateChange();
        return;
    }

    const row = parseInt(cardEl.dataset.row);
    const card = state.columns[col][row];

    if (!card.faceUp) return;

    if (selection === null) {
        selection = { col, row };
        onStateChange();
    } else if (selection.col === col && selection.row === row) {
        selection = null;
        onStateChange();
    } else if (selection.col === col) {
        selection = { col, row };
        onStateChange();
    } else {
        if (isLegalMove(state, selection.col, selection.row, col)) {
            doMove(selection.col, selection.row, col);
        } else {
            cardEl.classList.add('invalid-flash');
            setTimeout(() => cardEl.classList.remove('invalid-flash'), 300);
            selection = { col, row };
            onStateChange();
        }
    }
}

function handleStockClick() {
    if (state.stockDealt || state.stock.length === 0) return;

    selection = null;
    const move = { type: 'stock' };
    executeMove(state, move);

    if (onMoveMade) onMoveMade(move);

    if (isWon(state)) {
        onWin();
    } else {
        onStateChange();
    }
}

function doMove(fromCol, fromRow, toCol) {
    const move = { type: 'move', fromCol, fromRow, toCol };
    executeMove(state, move);
    selection = null;

    if (onMoveMade) onMoveMade(move);

    if (isWon(state)) {
        onWin();
    } else {
        onStateChange();
    }
}

export function doUndo() {
    selection = null;
    undoMove(state);
    if (onMoveMade) onMoveMade({ type: 'undo' });
    onStateChange();
}
