const runs = new Map();
const envelopes = new Map();
export function saveRun(record, envelope) {
    runs.set(record.id, record);
    if (envelope) {
        envelopes.set(record.id, envelope);
    }
    return record;
}
export function getRun(id) {
    return runs.get(id) || null;
}
export function getRunEnvelope(id) {
    return envelopes.get(id) || null;
}
export function updateRun(id, updater) {
    const existing = runs.get(id);
    if (!existing) {
        return null;
    }
    const next = updater(existing);
    runs.set(id, next);
    return next;
}
export function listRuns() {
    return Array.from(runs.values()).sort((left, right) => right.created_at.localeCompare(left.created_at));
}
