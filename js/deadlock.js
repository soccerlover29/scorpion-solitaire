import { getRank, getSuit } from './utils.js';

// Detect deadlock patterns that make a game unsolvable
// Returns { deadlocked: boolean, reason: string }

export function detectDeadlocks(state) {
    // P1: Buried same-suit dependency
    // Face-down card of rank R, suit S has card of rank R-1, suit S above it in same column
    for (let c = 0; c < state.columns.length; c++) {
        const col = state.columns[c];
        for (let r = 0; r < col.length; r++) {
            if (col[r].faceUp) continue; // Only check face-down cards

            const buriedRank = getRank(col[r].id);
            const buriedSuit = getSuit(col[r].id);

            // Look for the card that needs to go ON TOP of this buried card
            // (i.e., rank-1 same suit) anywhere above it in the same column
            for (let above = r + 1; above < col.length; above++) {
                const aboveCard = col[above];
                if (getRank(aboveCard.id) === buriedRank - 1 && getSuit(aboveCard.id) === buriedSuit) {
                    // The card that needs to go on the buried card is above it
                    // AND the buried card is face-down, so we can't access it
                    // Check if there are any face-down cards between them
                    // Actually, the buried card IS face-down, so the card above
                    // can never be placed on it until it's revealed
                    // But to reveal it, we need to move everything above it,
                    // including the card that needs to go on it
                    return {
                        deadlocked: true,
                        reason: `Buried dependency: face-down card needs its predecessor above it in column ${c}`
                    };
                }
            }
        }
    }

    // P2: Circular same-suit dependency among face-up cards in same column
    // e.g., 9C under 7C under 8C - the 8 needs the 9 but 7 is between them
    for (let c = 0; c < state.columns.length; c++) {
        const col = state.columns[c];
        if (hasCircularDependency(col)) {
            return {
                deadlocked: true,
                reason: `Circular dependency in column ${c}`
            };
        }
    }

    return { deadlocked: false, reason: null };
}

function hasCircularDependency(col) {
    // For each suit, collect the face-up cards of that suit in column order
    // Then check if any subset forms a cycle
    const bySuit = [[], [], [], []];

    for (let r = 0; r < col.length; r++) {
        const card = col[r];
        if (!card.faceUp) continue;
        bySuit[getSuit(card.id)].push({ rank: getRank(card.id), row: r });
    }

    for (let s = 0; s < 4; s++) {
        const cards = bySuit[s];
        if (cards.length < 2) continue;

        // Check for inversions that create mutual blocking
        // Card A at row rA with rank rankA, card B at row rB with rank rankB
        // If A is above B (rA < rB) but rankA < rankB, then A needs to go
        // after B in the sequence but is positioned before B
        // This alone isn't a deadlock - we might be able to move A away
        // But if there's a CYCLE of dependencies, it's a deadlock

        // Build dependency graph: card at rank R depends on card at rank R+1
        // If R+1 is below R in the column, that's fine (natural order)
        // If R+1 is above R, we need to move R+1 first, but then check if
        // moving R+1 requires something below R

        // Simple check: look for A above B above C where:
        // A needs to go on B or later, but C needs to go on A
        // making it impossible to extract any of them

        // More general: check if the column-order of same-suit cards
        // has a "wrong order" triple that creates mutual blocking

        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                // cards[i] is above cards[j] in the column
                const higher = cards[i]; // higher position (smaller row index)
                const lower = cards[j];  // lower position (larger row index)

                // If higher.rank > lower.rank, higher needs to be BELOW lower
                // in the final sequence, but is currently above.
                // To move higher, we need to grab it and everything below,
                // including lower. But lower needs to go above higher.
                // Check if there's a card between them that creates a lock.

                if (higher.rank > lower.rank) {
                    // Check if there's a card of the same suit between them
                    // whose rank is between lower.rank and higher.rank
                    for (let k = 0; k < cards.length; k++) {
                        if (k === i || k === j) continue;
                        const mid = cards[k];
                        if (mid.row > higher.row && mid.row < lower.row &&
                            mid.rank > lower.rank && mid.rank < higher.rank) {
                            // Three cards in wrong order - circular dependency
                            return true;
                        }
                    }

                    // Even without a middle card, if the higher-ranked card
                    // is directly above the lower-ranked one and there's no
                    // way to separate them (they're consecutive in the column
                    // with other same-suit cards involved), it could be a deadlock
                    // But this simpler case can often be resolved by moving
                    // the group elsewhere, so only flag the triple case
                }
            }
        }
    }

    return false;
}

// Quick deadlock check for solver pruning (faster, less thorough)
export function quickDeadlockCheck(state) {
    // Only check P1 (buried dependency) - fastest and most common
    for (let c = 0; c < state.columns.length; c++) {
        const col = state.columns[c];
        for (let r = 0; r < col.length; r++) {
            if (col[r].faceUp) continue;

            const buriedRank = getRank(col[r].id);
            const buriedSuit = getSuit(col[r].id);

            if (buriedRank === 0) continue; // Ace has no predecessor

            for (let above = r + 1; above < col.length; above++) {
                const aboveCard = col[above];
                if (getRank(aboveCard.id) === buriedRank - 1 && getSuit(aboveCard.id) === buriedSuit) {
                    return true;
                }
            }
        }
    }
    return false;
}
