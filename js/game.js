import {
    getRank, getSuit, isKing, isAce,
    NUM_COLUMNS, CARDS_PER_COLUMN, NUM_FACEDOWN_ROWS, NUM_FACEDOWN_COLS,
    STOCK_SIZE, createDeck, shuffle, createRNG, DECK_SIZE
} from './utils.js';

export function createGameState(seed) {
    const rng = seed != null ? createRNG(seed) : Math.random;
    const deck = shuffle(createDeck(), rng);

    const columns = [];
    let idx = 0;

    for (let c = 0; c < NUM_COLUMNS; c++) {
        const col = [];
        for (let r = 0; r < CARDS_PER_COLUMN; r++) {
            const faceUp = c >= NUM_FACEDOWN_COLS || r >= NUM_FACEDOWN_ROWS;
            col.push({ id: deck[idx++], faceUp });
        }
        columns.push(col);
    }

    const stock = [];
    for (let i = 0; i < STOCK_SIZE; i++) {
        stock.push(deck[idx++]);
    }

    return {
        columns,
        stock,
        stockDealt: false,
        foundations: [[], [], [], []],
        moveHistory: [],
        cardsRemaining: DECK_SIZE,
        seed: seed != null ? seed : null
    };
}

// Clone state for solver (no moveHistory needed)
export function cloneState(state) {
    return {
        columns: state.columns.map(col => col.map(c => ({ id: c.id, faceUp: c.faceUp }))),
        stock: [...state.stock],
        stockDealt: state.stockDealt,
        foundations: state.foundations.map(f => [...f]),
        moveHistory: [],
        cardsRemaining: state.cardsRemaining,
        seed: state.seed
    };
}

// Generate all legal moves for a state
// Returns array of {type, fromCol, fromRow, toCol} or {type:'stock'}
export function generateMoves(state) {
    const moves = [];
    const { columns, stock, stockDealt } = state;
    const emptyCols = [];

    for (let c = 0; c < NUM_COLUMNS; c++) {
        if (columns[c].length === 0) emptyCols.push(c);
    }

    for (let fromCol = 0; fromCol < NUM_COLUMNS; fromCol++) {
        const col = columns[fromCol];
        for (let fromRow = 0; fromRow < col.length; fromRow++) {
            const card = col[fromRow];
            if (!card.faceUp) continue;

            const cardRank = getRank(card.id);
            const cardSuit = getSuit(card.id);

            // King to empty column
            if (isKing(card.id) && fromRow !== 0 && emptyCols.length > 0) {
                // Only try one empty column (they're all equivalent)
                moves.push({
                    type: 'move',
                    fromCol,
                    fromRow,
                    toCol: emptyCols[0]
                });
            }

            // Move onto matching suit, rank+1
            for (let toCol = 0; toCol < NUM_COLUMNS; toCol++) {
                if (toCol === fromCol) continue;
                const targetCol = columns[toCol];
                if (targetCol.length === 0) continue;

                const target = targetCol[targetCol.length - 1];
                if (getSuit(target.id) === cardSuit && getRank(target.id) === cardRank + 1) {
                    moves.push({
                        type: 'move',
                        fromCol,
                        fromRow,
                        toCol
                    });
                }
            }
        }
    }

    // Deal stock
    if (!stockDealt && stock.length === STOCK_SIZE) {
        moves.push({ type: 'stock' });
    }

    return moves;
}

// Execute a move, mutating state. Returns undo info.
export function executeMove(state, move) {
    const undo = { move, revealedCards: [], completedRuns: [] };

    if (move.type === 'stock') {
        // Deal stock cards to columns 0, 1, 2
        for (let i = 0; i < STOCK_SIZE; i++) {
            state.columns[i].push({ id: state.stock[i], faceUp: true });
        }
        state.stockDealt = true;
        undo.stockCards = [...state.stock];
    } else {
        // Move cards from fromCol[fromRow..end] to toCol
        const { fromCol, fromRow, toCol } = move;
        const moving = state.columns[fromCol].splice(fromRow);
        state.columns[toCol].push(...moving);
        undo.movedCards = moving;
    }

    // Auto-flip exposed face-down cards
    for (let c = 0; c < NUM_COLUMNS; c++) {
        const col = state.columns[c];
        if (col.length > 0 && !col[col.length - 1].faceUp) {
            col[col.length - 1].faceUp = true;
            undo.revealedCards.push(c);
        }
    }

    // Check for completed runs (K down to A of same suit at bottom of column)
    checkAndRemoveRuns(state, undo);

    state.moveHistory.push(undo);
    return undo;
}

function checkAndRemoveRuns(state, undo) {
    for (let c = 0; c < NUM_COLUMNS; c++) {
        const col = state.columns[c];
        if (col.length < 13) continue;

        // Check bottom 13 cards for K-A same suit run
        const startIdx = col.length - 13;
        const suit = getSuit(col[startIdx].id);
        let isRun = true;

        for (let i = 0; i < 13; i++) {
            const card = col[startIdx + i];
            if (!card.faceUp || getSuit(card.id) !== suit || getRank(card.id) !== 12 - i) {
                isRun = false;
                break;
            }
        }

        if (isRun) {
            const run = col.splice(startIdx, 13);
            state.foundations[suit] = run.map(c => c.id);
            state.cardsRemaining -= 13;
            undo.completedRuns.push({ col: c, run, suit });

            // Auto-flip after run removal
            if (col.length > 0 && !col[col.length - 1].faceUp) {
                col[col.length - 1].faceUp = true;
                undo.revealedCards.push(c);
            }
        }
    }
}

// Undo the last move
export function undoMove(state) {
    if (state.moveHistory.length === 0) return false;
    const undo = state.moveHistory.pop();

    // Reverse completed runs
    for (let i = undo.completedRuns.length - 1; i >= 0; i--) {
        const { col, run, suit } = undo.completedRuns[i];
        state.columns[col].push(...run);
        state.foundations[suit] = [];
        state.cardsRemaining += 13;
    }

    // Un-flip revealed cards
    for (const c of undo.revealedCards) {
        const col = state.columns[c];
        if (col.length > 0) {
            col[col.length - 1].faceUp = false;
        }
    }

    if (undo.move.type === 'stock') {
        // Remove stock cards from columns 0, 1, 2
        for (let i = STOCK_SIZE - 1; i >= 0; i--) {
            state.columns[i].pop();
        }
        state.stockDealt = false;
    } else {
        // Move cards back
        const { fromCol, toCol } = undo.move;
        const count = undo.movedCards.length;
        const moving = state.columns[toCol].splice(-count);
        state.columns[fromCol].push(...moving);
    }

    return true;
}

export function isWon(state) {
    return state.cardsRemaining === 0;
}

// Count remaining cards not in foundations
export function countRemaining(state) {
    return state.cardsRemaining;
}

// Check if a move is legal
export function isLegalMove(state, fromCol, fromRow, toCol) {
    const col = state.columns[fromCol];
    if (fromRow < 0 || fromRow >= col.length) return false;
    if (!col[fromRow].faceUp) return false;

    const card = col[fromRow];
    const targetCol = state.columns[toCol];

    if (targetCol.length === 0) {
        return isKing(card.id);
    }

    const target = targetCol[targetCol.length - 1];
    return getSuit(target.id) === getSuit(card.id) && getRank(target.id) === getRank(card.id) + 1;
}
