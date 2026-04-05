import { useMemo } from "react";
import type { TestCase } from "../types";

type SuiteCasePickerProps = {
  cases: TestCase[];
  selectedCaseIds: string[];
  onChange: (nextIds: string[]) => void;
  heading: string;
  description: string;
  emptyMessage: string;
};

const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [movedItem] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, movedItem);
  return next;
};

export function SuiteCasePicker({
  cases,
  selectedCaseIds,
  onChange,
  heading,
  description,
  emptyMessage
}: SuiteCasePickerProps) {
  const caseById = useMemo(() => new Map(cases.map((testCase) => [testCase.id, testCase])), [cases]);
  const allCaseIds = useMemo(() => cases.map((testCase) => testCase.id), [cases]);
  const selectedCases = useMemo(
    () => selectedCaseIds.map((id) => caseById.get(id)).filter((testCase): testCase is TestCase => Boolean(testCase)),
    [caseById, selectedCaseIds]
  );
  const selectedIdSet = useMemo(() => new Set(selectedCaseIds), [selectedCaseIds]);
  const areAllCasesSelected = Boolean(cases.length) && selectedCases.length === cases.length;

  const toggleCase = (testCaseId: string) => {
    if (selectedIdSet.has(testCaseId)) {
      onChange(selectedCaseIds.filter((id) => id !== testCaseId));
      return;
    }

    onChange([...selectedCaseIds, testCaseId]);
  };

  const moveSelectedCase = (testCaseId: string, direction: "up" | "down") => {
    const currentIndex = selectedCaseIds.indexOf(testCaseId);

    if (currentIndex === -1) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    onChange(moveItem(selectedCaseIds, currentIndex, targetIndex));
  };

  return (
    <div className="modal-case-picker">
      <div className="suite-case-picker-toolbar">
        <div>
          <strong>{heading}</strong>
          <span>{description}</span>
        </div>
        <div className="suite-case-picker-actions">
          <button className="ghost-button" disabled={!cases.length || areAllCasesSelected} onClick={() => onChange(allCaseIds)} type="button">
            Select all
          </button>
          <button className="ghost-button" disabled={!selectedCaseIds.length} onClick={() => onChange([])} type="button">
            Clear selection
          </button>
        </div>
      </div>

      <div className="detail-summary suite-case-picker-summary">
        <strong>{selectedCases.length} test case{selectedCases.length === 1 ? "" : "s"} selected</strong>
        <span>{selectedCases.length ? "Selected cases will be saved in this order." : "Select cases to assign them into this suite."}</span>
      </div>

      {selectedCases.length ? (
        <div className="suite-selected-case-list">
          {selectedCases.map((testCase, index) => (
            <div className="suite-selected-case-item" key={testCase.id}>
              <div className="suite-selected-case-copy">
                <strong>{index + 1}. {testCase.title}</strong>
                <span>{testCase.description || "No description yet for this test case."}</span>
              </div>
              <div className="suite-selected-case-actions">
                <button className="ghost-button" disabled={index === 0} onClick={() => moveSelectedCase(testCase.id, "up")} type="button">
                  Up
                </button>
                <button className="ghost-button" disabled={index === selectedCases.length - 1} onClick={() => moveSelectedCase(testCase.id, "down")} type="button">
                  Down
                </button>
                <button className="ghost-button danger" onClick={() => toggleCase(testCase.id)} type="button">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!cases.length ? <div className="empty-state compact">{emptyMessage}</div> : null}

      {cases.length ? (
        <div className="suite-case-picker-list">
          {cases.map((testCase) => (
            <label className="modal-case-option" key={testCase.id}>
              <input checked={selectedIdSet.has(testCase.id)} onChange={() => toggleCase(testCase.id)} type="checkbox" />
              <span>{testCase.title}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
