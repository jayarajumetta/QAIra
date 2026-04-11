const db = require("../db");
const { v4: uuid } = require("uuid");

const selectTestCase = db.prepare(`
  SELECT id, app_type_id
  FROM test_cases
  WHERE id = ?
`);

const selectSharedStepGroup = db.prepare(`
  SELECT id, app_type_id, name, steps
  FROM shared_step_groups
  WHERE id = ?
`);

const selectStep = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE id = ?
`);

const selectStepsForCase = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

const insertStep = db.prepare(`
  INSERT INTO test_steps (
    id,
    test_case_id,
    step_order,
    action,
    expected_result,
    group_id,
    group_name,
    group_kind,
    reusable_group_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateStep = db.prepare(`
  UPDATE test_steps
  SET
    test_case_id = ?,
    step_order = ?,
    action = ?,
    expected_result = ?,
    group_id = ?,
    group_name = ?,
    group_kind = ?,
    reusable_group_id = ?
  WHERE id = ?
`);

const deleteStep = db.prepare(`
  DELETE FROM test_steps
  WHERE id = ?
`);

const shiftStepOrdersForward = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order + ?
  WHERE test_case_id = ? AND step_order >= ?
`);

const shiftStepOrdersBackward = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order - 1
  WHERE test_case_id = ? AND step_order > ?
`);

const moveStepsUp = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order + 1
  WHERE test_case_id = ? AND step_order >= ? AND step_order < ?
`);

const moveStepsDown = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order - 1
  WHERE test_case_id = ? AND step_order > ? AND step_order <= ?
`);

const setStepGroup = db.prepare(`
  UPDATE test_steps
  SET group_id = ?, group_name = ?, group_kind = ?, reusable_group_id = ?
  WHERE id = ?
`);

const clearGroupByCase = db.prepare(`
  UPDATE test_steps
  SET group_id = NULL, group_name = NULL, group_kind = NULL, reusable_group_id = NULL
  WHERE test_case_id = ? AND group_id = ?
`);

const updateOrder = db.prepare(`
  UPDATE test_steps
  SET step_order = ?
  WHERE id = ?
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeGroupKind = (value) => {
  if (value === "local" || value === "reusable") {
    return value;
  }

  return null;
};

const normalizeStepOrder = (value, fallback = 1) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(numeric));
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const normalizeSharedSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult)
    }))
    .filter((step) => step.action || step.expected_result)
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const ensureTestCase = async (testCaseId) => {
  const testCase = await selectTestCase.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  return testCase;
};

const ensureStep = async (id) => {
  const step = await selectStep.get(id);

  if (!step) {
    throw new Error("Test step not found");
  }

  return step;
};

const listStepsForCase = async (testCaseId) => {
  return selectStepsForCase.all(testCaseId);
};

exports.createTestStep = async ({
  test_case_id,
  step_order,
  action,
  expected_result,
  group_id,
  group_name,
  group_kind,
  reusable_group_id
}) => {
  if (!test_case_id || step_order === undefined) {
    throw new Error("Missing required fields");
  }

  await ensureTestCase(test_case_id);

  const id = uuid();
  const transaction = db.transaction(async () => {
    const existingSteps = await listStepsForCase(test_case_id);
    const targetOrder = normalizeStepOrder(step_order, existingSteps.length + 1);
    const boundedOrder = Math.min(targetOrder, existingSteps.length + 1);

    await shiftStepOrdersForward.run(1, test_case_id, boundedOrder);
    await insertStep.run(
      id,
      test_case_id,
      boundedOrder,
      normalizeText(action),
      normalizeText(expected_result),
      normalizeText(group_id),
      normalizeText(group_name),
      normalizeGroupKind(group_kind || (group_id ? "local" : null)),
      normalizeText(reusable_group_id)
    );
  });

  await transaction();
  return { id };
};

exports.getTestSteps = async ({ test_case_id }) => {
  let query = `SELECT * FROM test_steps WHERE 1=1`;
  const params = [];

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  query += ` ORDER BY test_case_id ASC, step_order ASC, id ASC`;

  return db.prepare(query).all(...params);
};

exports.getTestStep = async (id) => {
  return ensureStep(id);
};

exports.updateTestStep = async (id, data = {}) => {
  const existing = await ensureStep(id);
  const nextTestCaseId = data.test_case_id ?? existing.test_case_id;
  const nextStepOrder = data.step_order !== undefined ? normalizeStepOrder(data.step_order, existing.step_order) : existing.step_order;
  await ensureTestCase(nextTestCaseId);

  const transaction = db.transaction(async () => {
    if (nextTestCaseId !== existing.test_case_id) {
      const targetSteps = await listStepsForCase(nextTestCaseId);
      const boundedOrder = Math.min(nextStepOrder, targetSteps.length + 1);

      await shiftStepOrdersBackward.run(existing.test_case_id, existing.step_order);
      await shiftStepOrdersForward.run(1, nextTestCaseId, boundedOrder);

      await updateStep.run(
        nextTestCaseId,
        boundedOrder,
        data.action !== undefined ? normalizeText(data.action) : existing.action,
        data.expected_result !== undefined ? normalizeText(data.expected_result) : existing.expected_result,
        data.group_id !== undefined ? normalizeText(data.group_id) : existing.group_id,
        data.group_name !== undefined ? normalizeText(data.group_name) : existing.group_name,
        data.group_kind !== undefined ? normalizeGroupKind(data.group_kind) : existing.group_kind,
        data.reusable_group_id !== undefined ? normalizeText(data.reusable_group_id) : existing.reusable_group_id,
        id
      );
      return;
    }

    if (nextStepOrder < existing.step_order) {
      await moveStepsUp.run(existing.test_case_id, nextStepOrder, existing.step_order);
    } else if (nextStepOrder > existing.step_order) {
      await moveStepsDown.run(existing.test_case_id, existing.step_order, nextStepOrder);
    }

    await updateStep.run(
      nextTestCaseId,
      nextStepOrder,
      data.action !== undefined ? normalizeText(data.action) : existing.action,
      data.expected_result !== undefined ? normalizeText(data.expected_result) : existing.expected_result,
      data.group_id !== undefined ? normalizeText(data.group_id) : existing.group_id,
      data.group_name !== undefined ? normalizeText(data.group_name) : existing.group_name,
      data.group_kind !== undefined ? normalizeGroupKind(data.group_kind) : existing.group_kind,
      data.reusable_group_id !== undefined ? normalizeText(data.reusable_group_id) : existing.reusable_group_id,
      id
    );
  });

  await transaction();
  return { updated: true };
};

exports.reorderTestSteps = async (testCaseId, stepIds = []) => {
  await ensureTestCase(testCaseId);

  if (!Array.isArray(stepIds) || !stepIds.length) {
    throw new Error("step_ids must be a non-empty array");
  }

  const existingSteps = await listStepsForCase(testCaseId);

  if (existingSteps.length !== stepIds.length) {
    throw new Error("step_ids must include every step in the test case");
  }

  const existingIds = existingSteps.map((step) => step.id).sort();
  const proposedIds = [...new Set(stepIds)].sort();

  if (existingIds.length !== proposedIds.length || existingIds.some((item, index) => item !== proposedIds[index])) {
    throw new Error("step_ids must match the steps belonging to the test case");
  }

  const transaction = db.transaction(async () => {
    for (const [index, stepId] of stepIds.entries()) {
      await updateOrder.run(index + 1, stepId);
    }
  });

  await transaction();
  return { reordered: true };
};

exports.duplicateTestSteps = async ({ test_case_id, step_ids = [], insert_after_step_id }) => {
  if (!test_case_id || !Array.isArray(step_ids) || !step_ids.length) {
    throw new Error("test_case_id and step_ids are required");
  }

  await ensureTestCase(test_case_id);
  const uniqueStepIds = [...new Set(step_ids)];

  const transaction = db.transaction(async () => {
    const existingSteps = await listStepsForCase(test_case_id);
    const selectedSteps = existingSteps.filter((step) => uniqueStepIds.includes(step.id));

    if (selectedSteps.length !== uniqueStepIds.length) {
      throw new Error("All duplicated steps must belong to the selected test case");
    }

    const insertAfterStep = insert_after_step_id
      ? existingSteps.find((step) => step.id === insert_after_step_id)
      : selectedSteps[selectedSteps.length - 1];

    if (!insertAfterStep) {
      throw new Error("Unable to determine where to duplicate the selected steps");
    }

    const insertionOrder = insertAfterStep.step_order + 1;
    const nextGroupIds = new Map();

    selectedSteps.forEach((step) => {
      if (step.group_id && !nextGroupIds.has(step.group_id)) {
        nextGroupIds.set(step.group_id, uuid());
      }
    });

    await shiftStepOrdersForward.run(selectedSteps.length, test_case_id, insertionOrder);

    for (const [index, step] of selectedSteps.entries()) {
      await insertStep.run(
        uuid(),
        test_case_id,
        insertionOrder + index,
        step.action,
        step.expected_result,
        step.group_id ? nextGroupIds.get(step.group_id) : null,
        step.group_name,
        step.group_kind,
        step.reusable_group_id
      );
    }
  });

  await transaction();
  return { duplicated: true };
};

exports.groupTestSteps = async ({ test_case_id, step_ids = [], name, kind = "local", reusable_group_id }) => {
  if (!test_case_id || !Array.isArray(step_ids) || !step_ids.length) {
    throw new Error("test_case_id and step_ids are required");
  }

  const resolvedName = normalizeText(name);

  if (!resolvedName) {
    throw new Error("Group name is required");
  }

  await ensureTestCase(test_case_id);
  const existingSteps = await listStepsForCase(test_case_id);
  const uniqueStepIds = [...new Set(step_ids)];
  const selectedSteps = existingSteps.filter((step) => uniqueStepIds.includes(step.id));

  if (selectedSteps.length !== uniqueStepIds.length) {
    throw new Error("All grouped steps must belong to the selected test case");
  }

  const isContiguous = selectedSteps.every((step, index) => index === 0 || step.step_order === selectedSteps[index - 1].step_order + 1);

  if (!isContiguous) {
    throw new Error("Select a continuous step range before grouping");
  }

  const groupId = uuid();
  const resolvedKind = normalizeGroupKind(kind) || "local";

  const transaction = db.transaction(async () => {
    for (const step of selectedSteps) {
      await setStepGroup.run(groupId, resolvedName, resolvedKind, normalizeText(reusable_group_id), step.id);
    }
  });

  await transaction();
  return { grouped: true, group_id: groupId };
};

exports.ungroupTestSteps = async ({ test_case_id, group_id }) => {
  if (!test_case_id || !group_id) {
    throw new Error("test_case_id and group_id are required");
  }

  await ensureTestCase(test_case_id);
  await clearGroupByCase.run(test_case_id, group_id);
  return { updated: true };
};

exports.insertSharedStepGroup = async ({ test_case_id, shared_step_group_id, insert_after_step_id }) => {
  if (!test_case_id || !shared_step_group_id) {
    throw new Error("test_case_id and shared_step_group_id are required");
  }

  const testCase = await ensureTestCase(test_case_id);
  const sharedGroup = await selectSharedStepGroup.get(shared_step_group_id);

  if (!sharedGroup) {
    throw new Error("Shared step group not found");
  }

  if (testCase.app_type_id && sharedGroup.app_type_id !== testCase.app_type_id) {
    throw new Error("Shared step group must belong to the same app type");
  }

  const sharedSteps = normalizeSharedSteps(parseJsonValue(sharedGroup.steps, []));

  if (!sharedSteps.length) {
    throw new Error("Shared step group does not contain any steps");
  }

  const transaction = db.transaction(async () => {
    const existingSteps = await listStepsForCase(test_case_id);
    const insertAfterStep = insert_after_step_id
      ? existingSteps.find((step) => step.id === insert_after_step_id)
      : existingSteps[existingSteps.length - 1];

    if (insert_after_step_id && !insertAfterStep) {
      throw new Error("Insert target step was not found in the selected test case");
    }

    const insertionOrder = insertAfterStep ? insertAfterStep.step_order + 1 : 1;
    const groupInstanceId = uuid();

    await shiftStepOrdersForward.run(sharedSteps.length, test_case_id, insertionOrder);

    for (const [index, step] of sharedSteps.entries()) {
      await insertStep.run(
        uuid(),
        test_case_id,
        insertionOrder + index,
        step.action,
        step.expected_result,
        groupInstanceId,
        sharedGroup.name,
        "reusable",
        sharedGroup.id
      );
    }
  });

  await transaction();
  return { inserted: true };
};

exports.deleteTestStep = async (id) => {
  const step = await ensureStep(id);

  const transaction = db.transaction(async () => {
    await deleteStep.run(id);
    await shiftStepOrdersBackward.run(step.test_case_id, step.step_order);
  });

  await transaction();
  return { deleted: true };
};
