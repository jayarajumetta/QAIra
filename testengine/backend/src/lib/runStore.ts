import type { EngineRunRecord } from "../contracts/qaira.js";

const runs = new Map<string, EngineRunRecord>();

export function saveRun(record: EngineRunRecord) {
  runs.set(record.id, record);
  return record;
}

export function getRun(id: string) {
  return runs.get(id) || null;
}

export function listRuns() {
  return Array.from(runs.values()).sort((left, right) => right.created_at.localeCompare(left.created_at));
}
