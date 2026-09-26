// Purpose: Converts SQLite, JavaScript, or form date values into valid Date objects.
// Inputs: Date-like value. Outputs: Date object or null when invalid.
function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const normalized = typeof value === 'string' ? value.replace(' ', 'T') : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Purpose: Formats dates consistently for the Singapore-facing interface.
// Inputs: Date-like value. Outputs: Human-readable date or TBC.
function formatDateDisplay(value) {
    const date = toDate(value);
    if (!date) return 'TBC';
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Singapore'
    }).format(date);
}

// Purpose: Formats date-time values consistently for the Singapore-facing interface.
// Inputs: Date-like value. Outputs: Human-readable date and time or TBC.
function formatDateTimeDisplay(value) {
    const date = toDate(value);
    if (!date) return 'TBC';
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Singapore'
    }).format(date);
}

// Purpose: Counts words for server-rendered content summaries.
// Inputs: Any text-like value. Outputs: Non-negative word count.
function countWords(text) {
    return String(text || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;
}

module.exports = {
    toDate,
    formatDateDisplay,
    formatDateTimeDisplay,
    countWords
};
