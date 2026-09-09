// Google Sheet CSV URL — optional external sync
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR2n6_JjRA6miQySJzdlUo4qDIe828nP4_VW-16uldTlhY31-9bI9bKovA0R7JjQeyYCK46JZWX7I8h/pub?output=csv";

// Secondary elements to update from sheet if present
const STAT_ID_PAIRS = [
    ['total-stock-val'],
    ['stock-out-val'],
    ['stock-in-val'],
    ['low-stock-val']
];

function updateStat(ids, value) {
    if (value === undefined || value === '') return;
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value;
        }
    });
}

function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return;

    const values = lines[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    STAT_ID_PAIRS.forEach((ids, index) => {
        if (values[index] !== undefined && values[index] !== '') {
            updateStat(ids, values[index]);
        }
    });

    if (typeof window.updateDashboardStats === 'function') {
        window.updateDashboardStats();
    }
}

async function fetchSheetData() {
    try {
        const response = await fetch(SHEET_URL);
        if (response.ok) {
            const csvText = await response.text();
            parseCSV(csvText);
        }
    } catch (error) {
        // Fallback to local live calculation
    } finally {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchSheetData();
});

