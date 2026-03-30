import { getRank, getSuit, RANK_NAMES, SUIT_SYMBOLS, suitColor, NUM_COLUMNS } from './utils.js';

let tableau, stockArea, foundationArea;

// Compute card dimensions from CSS custom properties by measuring a temp element
function getCardMetrics() {
    const root = document.documentElement;
    const style = getComputedStyle(root);

    // Create a temp element to resolve CSS calc/clamp values
    const temp = document.createElement('div');
    temp.style.position = 'absolute';
    temp.style.visibility = 'hidden';
    temp.style.width = style.getPropertyValue('--card-width');
    document.body.appendChild(temp);
    const cardWidth = temp.getBoundingClientRect().width;
    document.body.removeChild(temp);

    return {
        cardWidth,
        cardHeight: cardWidth * 1.45,
        faceUpOffset: cardWidth * 0.35,
        faceDownOffset: cardWidth * 0.15
    };
}

export function initRenderer() {
    tableau = document.getElementById('tableau');
    stockArea = document.getElementById('stock-area');
    foundationArea = document.getElementById('foundation-area');
}

export function renderState(state, selection, hint) {
    renderTableau(state, selection, hint);
    renderStock(state, hint);
    renderFoundations(state);
    updateCardsRemaining(state);
}

function renderTableau(state, selection, hint) {
    tableau.innerHTML = '';
    const metrics = getCardMetrics();

    for (let c = 0; c < NUM_COLUMNS; c++) {
        const colDiv = document.createElement('div');
        colDiv.className = 'column';
        colDiv.dataset.col = c;

        const col = state.columns[c];

        if (col.length === 0) {
            colDiv.style.minHeight = metrics.cardHeight + 'px';
        }

        let topOffset = 0;
        for (let r = 0; r < col.length; r++) {
            const card = col[r];
            const cardDiv = document.createElement('div');

            if (card.faceUp) {
                const rank = getRank(card.id);
                const suit = getSuit(card.id);
                const color = suitColor(card.id);

                cardDiv.className = `card face-up ${color}`;
                cardDiv.innerHTML = `
                    <div class="card-inner">
                        <div class="card-top">
                            <span class="card-rank">${RANK_NAMES[rank]}</span>
                            <span class="card-suit">${SUIT_SYMBOLS[suit]}</span>
                        </div>
                        <span class="card-center-suit">${SUIT_SYMBOLS[suit]}</span>
                        <div class="card-bottom">
                            <span class="card-rank">${RANK_NAMES[rank]}</span>
                            <span class="card-suit">${SUIT_SYMBOLS[suit]}</span>
                        </div>
                    </div>
                `;
            } else {
                cardDiv.className = 'card face-down';
            }

            cardDiv.style.top = topOffset + 'px';
            cardDiv.style.zIndex = r + 1;
            cardDiv.dataset.col = c;
            cardDiv.dataset.row = r;

            // Selection highlighting
            if (selection && selection.col === c && r >= selection.row) {
                cardDiv.classList.add('selected');
            }

            // Hint highlighting
            if (hint) {
                if (hint.fromCol === c && r === hint.fromRow) {
                    cardDiv.classList.add('hint-source');
                }
                if (hint.toCol === c && r === col.length - 1) {
                    cardDiv.classList.add('hint-target');
                }
            }

            colDiv.appendChild(cardDiv);
            topOffset += card.faceUp ? metrics.faceUpOffset : metrics.faceDownOffset;
        }

        // Set column height to contain all cards
        if (col.length > 0) {
            colDiv.style.height = (topOffset + metrics.cardHeight) + 'px';
        }

        tableau.appendChild(colDiv);
    }

    // Highlight valid drop targets if there's a selection
    if (selection) {
        highlightDropTargets(state, selection);
    }
}

function highlightDropTargets(state, selection) {
    const card = state.columns[selection.col][selection.row];
    const cardRank = getRank(card.id);
    const cardSuit = getSuit(card.id);
    const isKingCard = cardRank === 12;

    const colDivs = tableau.querySelectorAll('.column');
    for (let c = 0; c < NUM_COLUMNS; c++) {
        if (c === selection.col) continue;
        const targetCol = state.columns[c];

        let valid = false;
        if (targetCol.length === 0) {
            valid = isKingCard;
        } else {
            const target = targetCol[targetCol.length - 1];
            valid = getSuit(target.id) === cardSuit && getRank(target.id) === cardRank + 1;
        }

        if (valid) {
            colDivs[c].classList.add('drop-target');
        }
    }
}

function renderStock(state, hint) {
    stockArea.innerHTML = '';
    const isStockHint = hint && hint.type === 'stock';

    for (let i = 0; i < 3; i++) {
        const slot = document.createElement('div');
        if (!state.stockDealt && i < state.stock.length) {
            slot.className = 'stock-card has-card';
            if (isStockHint) {
                slot.classList.add('hint-source');
            }
        } else {
            slot.className = 'stock-card empty';
        }
        stockArea.appendChild(slot);
    }
}

function renderFoundations(state) {
    foundationArea.innerHTML = '';

    for (let s = 0; s < 4; s++) {
        const slot = document.createElement('div');
        const foundation = state.foundations[s];

        if (foundation.length > 0) {
            slot.className = 'foundation-slot filled';
            slot.innerHTML = `<span style="color:${s === 1 || s === 2 ? '#d32f2f' : '#222'}">${SUIT_SYMBOLS[s]}</span>`;
        } else {
            slot.className = 'foundation-slot';
            slot.innerHTML = `<span>${SUIT_SYMBOLS[s]}</span>`;
        }

        foundationArea.appendChild(slot);
    }
}

function updateCardsRemaining(state) {
    const el = document.getElementById('cards-remaining');
    if (el) {
        el.textContent = `Cards: ${state.cardsRemaining}`;
    }
}

export function setStatusBanner(text, className) {
    const banner = document.getElementById('status-banner');
    banner.textContent = text;
    banner.className = className || '';
}

export function clearHints() {
    document.querySelectorAll('.hint-source, .hint-target').forEach(el => {
        el.classList.remove('hint-source', 'hint-target');
    });
}
