// Card encoding: cardId = suit * 13 + rank
// Rank: 0=Ace, 1=2, 2=3, ... 9=10, 10=Jack, 11=Queen, 12=King
// Suit: 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades

export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const RANK_NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const NUM_SUITS = 4;
export const NUM_RANKS = 13;
export const DECK_SIZE = 52;
export const NUM_COLUMNS = 7;
export const CARDS_PER_COLUMN = 7;
export const NUM_FACEDOWN_ROWS = 3;
export const NUM_FACEDOWN_COLS = 4; // columns 0-3 have face-down cards
export const STOCK_SIZE = 3;

export function getRank(cardId) {
    return cardId % 13;
}

export function getSuit(cardId) {
    return Math.floor(cardId / 13);
}

export function cardName(cardId) {
    return `${RANK_NAMES[getRank(cardId)]}${SUIT_SYMBOLS[getSuit(cardId)]}`;
}

export function suitColor(cardId) {
    const suit = getSuit(cardId);
    return (suit === 1 || suit === 2) ? 'red' : 'black';
}

export function isKing(cardId) {
    return getRank(cardId) === 12;
}

export function isAce(cardId) {
    return getRank(cardId) === 0;
}

// Seeded PRNG (Linear Congruential Generator)
export function createRNG(seed) {
    let s = seed | 0;
    return function () {
        s = (s * 1664525 + 1013904223) | 0;
        return (s >>> 0) / 4294967296;
    };
}

// Fisher-Yates shuffle
export function shuffle(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Create a full deck as array [0..51]
export function createDeck() {
    return Array.from({ length: DECK_SIZE }, (_, i) => i);
}

// Hash a game state for transposition table
export function hashState(columns, stockDealt) {
    let h = stockDealt ? '1|' : '0|';
    for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        for (let r = 0; r < col.length; r++) {
            h += col[r].faceUp ? col[r].id : ('d' + col[r].id);
            if (r < col.length - 1) h += ',';
        }
        h += '|';
    }
    return h;
}
