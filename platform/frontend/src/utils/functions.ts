// Format a time in seconds to a full breakdown (x days x hours x minutes x seconds)
export function formatSecondsFull(seconds: number, flagLongName: boolean): string {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '';
    if (seconds < 0) return '0' + (flagLongName ? ' seconds' : 's');
    seconds = Math.floor(seconds);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}${flagLongName ? ' days' : 'd'}`);
    if (hours > 0) parts.push(`${hours}${flagLongName ? ' hours' : 'h'}`);
    if (minutes > 0) parts.push(`${minutes}${flagLongName ? ' minutes' : 'm'}`);
    // Always show seconds, even if zero
    if (secs > 0 || parts.length === 0) parts.push(`${secs}${flagLongName ? ' seconds' : 's'}`);
    return parts.join(' ');
}

// Format a time in seconds to a human-readable string (x seconds, y minutes, z hours, w days)
export function formatSecondsHuman(seconds: number): string {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '';
    if (seconds < 60) {
        return `${parseFloat(seconds.toFixed(1))} s`;
    } else if (seconds < 3600) {
        const mins = seconds / 60;
        return `${parseFloat(mins.toFixed(1))} m`;
    } else if (seconds < 86400) {
        const hours = seconds / 3600;
        return `${parseFloat(hours.toFixed(1))} h`;
    } else {
        const days = seconds / 86400;
        return `${parseFloat(days.toFixed(1))} d`;
    }
}
// Normalize activity names for frontend lookup keys produced by the backend.
export const normalizeActivityName = (name: string): string => {
    if (!name || typeof name !== 'string') return ''

    let normalized = name.toLowerCase().trim()

    // Replace anything that is NOT:
    // - a-z
    // - 0-9
    // - Portuguese accented characters
    // - underscore
    // - &
    // with "-"
    normalized = normalized.replace(/[^a-z0-9áéíóúàâêîôûãõç_&]+/g, '-')

    // Remove leading/trailing dashes
    normalized = normalized.replace(/^-+|-+$/g, '')

    return normalized
}
