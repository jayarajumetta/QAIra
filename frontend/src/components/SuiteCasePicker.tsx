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
  const orderedCases = useMemo(
    () => [
      ...selectedCases,
      ...cases.filter((testCase) => !selectedCaseIds.includes(testCase.id))
    ],
    [cases, selectedCaseIds, selectedCases]
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
        <span>
          {selectedCases.length
            ? "Checked cases stay pinned to the top and will be saved in this order."
            : "Select cases to assign them into this suite."}
        </span>
      </div>

      {!cases.length ? <div className="empty-state compact">{emptyMessage}</div> : null}

      {cases.length ? (
        <div className="suite-case-picker-list suite-case-picker-list--ordered">
          {orderedCases.map((testCase) => {
            const selectedIndex = selectedCaseIds.indexOf(testCase.id);
            const isSelected = selectedIndex >= 0;

            return (
              <div className={isSelected ? "suite-case-picker-option is-selected" : "suite-case-picker-option"} key={testCase.id}>
                <label className="suite-case-picker-option-label">
                  <input checked={isSelected} onChange={() => toggleCase(testCase.id)} type="checkbox" />
                  <div className="suite-case-picker-option-copy">
                    <div className="suite-case-picker-option-title">
                      {isSelected ? <span className="suite-case-picker-order">{selectedIndex + 1}</span> : null}
                      <strong>{testCase.title}</strong>
                    </div>
                    <span>{testCase.description || "No description yet for this test case."}</span>
                  </div>
                </label>

                <div className="suite-case-picker-option-actions" role="group" aria-label={`${testCase.title} ordering controls`}>
                  <button
                    aria-label={`Move ${testCase.title} up`}
                    className="ghost-button suite-case-picker-move"
                    disabled={!isSelected || selectedIndex === 0}
                    onClick={(event) => {
                      event.preventDefault();
                      moveSelectedCase(testCase.id, "up");
                    }}
                    type="button"
                  >
                    <SuiteCasePickerArrowIcon direction="up" />
                  </button>
                  <button
                    aria-label={`Move ${testCase.title} down`}
                    className="ghost-button suite-case-picker-move"
                    disabled={!isSelected || selectedIndex === selectedCases.length - 1}
                    onClick={(event) => {
                      event.preventDefault();
                      moveSelectedCase(testCase.id, "down");
                    }}
                    type="button"
                  >
                    <SuiteCasePickerArrowIcon direction="down" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SuiteCasePickerArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      {direction === "up" ? <path d="m7 14 5-5 5 5" /> : <path d="m7 10 5 5 5-5" />}
    </svg>
  );
}
