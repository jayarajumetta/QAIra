const executionService = require("./execution.service");
const executionResultService = require("./executionResult.service");
const executionStepRuntimeService = require("./executionStepRuntime.service");
const emailService = require("./email.service");
const workspaceTransactionService = require("./workspaceTransaction.service");

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "Not recorded";
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? normalized : date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
};

const formatDuration = (value) => {
  const ms = Number(value || 0);

  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }

  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (!minutes) {
    return `${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${hours}h ${remainingMinutes}m`;
};

const pickLatestResultsByCase = (results) => {
  const byCaseId = new Map();

  results.forEach((result) => {
    const current = byCaseId.get(result.test_case_id);
    const currentDate = current?.created_at ? new Date(current.created_at).getTime() : 0;
    const nextDate = result.created_at ? new Date(result.created_at).getTime() : 0;

    if (!current || nextDate >= currentDate) {
      byCaseId.set(result.test_case_id, result);
    }
  });

  return byCaseId;
};

const deriveStepRows = (steps, logs) =>
  steps
    .slice()
    .sort((left, right) => Number(left.step_order || 0) - Number(right.step_order || 0))
    .map((step) => ({
      id: step.id,
      order: step.step_order,
      type: step.step_type || "web",
      action: step.action || "",
      expected_result: step.expected_result || "",
      status: logs.stepStatuses?.[step.id] || "queued",
      note: logs.stepNotes?.[step.id] || "",
      has_evidence: Boolean(logs.stepEvidence?.[step.id]?.dataUrl),
      captures: logs.stepCaptures?.[step.id] || logs.stepApiDetails?.[step.id]?.captures || {}
    }));

const deriveCaseStatus = (steps, result, logs) => {
  const status = normalizeText(result?.status);

  if (status) {
    return status;
  }

  return executionStepRuntimeService.deriveCaseStatusFromStepStatuses(
    steps.map((step) => step.id),
    logs.stepStatuses || {}
  );
};

const buildReportModel = async (executionId) => {
  const execution = await executionService.getExecution(executionId);
  const results = await executionResultService.getExecutionResults({ execution_id: executionId });
  const latestResultByCaseId = pickLatestResultsByCase(results);
  const stepsByCaseId = new Map();

  (execution.step_snapshots || []).forEach((snapshot) => {
    const step = {
      id: snapshot.snapshot_step_id,
      step_order: snapshot.step_order,
      step_type: snapshot.step_type,
      action: snapshot.action,
      expected_result: snapshot.expected_result
    };
    const current = stepsByCaseId.get(snapshot.test_case_id) || [];
    current.push(step);
    stepsByCaseId.set(snapshot.test_case_id, current);
  });

  const cases = (execution.case_snapshots || []).map((snapshot) => {
    const result = latestResultByCaseId.get(snapshot.test_case_id) || null;
    const logs = executionStepRuntimeService.parseStructuredLogs(result?.logs || null);
    const steps = deriveStepRows(stepsByCaseId.get(snapshot.test_case_id) || [], logs);
    const status = deriveCaseStatus(steps, result, logs);

    return {
      id: snapshot.test_case_id,
      title: snapshot.test_case_title,
      description: snapshot.test_case_description || "",
      suite_id: snapshot.suite_id || null,
      suite_name: snapshot.suite_name || null,
      priority: snapshot.priority || null,
      status,
      duration_ms: result?.duration_ms || 0,
      error: result?.error || "",
      result_id: result?.id || null,
      steps
    };
  });

  const counts = cases.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      if (item.status === "passed") {
        accumulator.passed += 1;
      } else if (item.status === "failed") {
        accumulator.failed += 1;
      } else if (item.status === "blocked") {
        accumulator.blocked += 1;
      } else {
        accumulator.running += 1;
      }
      return accumulator;
    },
    { total: 0, passed: 0, failed: 0, blocked: 0, running: 0 }
  );

  const durationMs = cases.reduce((total, item) => total + Number(item.duration_ms || 0), 0);
  const passRate = counts.total ? Math.round((counts.passed / counts.total) * 100) : 0;

  return {
    execution,
    generated_at: new Date().toISOString(),
    summary: {
      ...counts,
      pass_rate: passRate,
      duration_ms: durationMs
    },
    cases
  };
};

const statusClass = (status) =>
  status === "passed" || status === "completed"
    ? "pass"
    : status === "failed"
      ? "fail"
      : status === "blocked"
        ? "warn"
        : "run";

const renderReportHtml = (report) => {
  const execution = report.execution;
  const summary = report.summary;
  const title = execution.name || "Execution run report";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f5f7fb;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:980px;margin:0 auto;padding:28px;">
      <div style="background:#ffffff;border:1px solid #dfe5ef;border-radius:8px;padding:24px;">
        <p style="margin:0 0 8px;color:#536173;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">QAira Run Report</p>
        <h1 style="margin:0 0 8px;font-size:28px;line-height:1.15;color:#101928;">${escapeHtml(title)}</h1>
        <p style="margin:0;color:#536173;">Generated ${escapeHtml(formatDate(report.generated_at))} · Started ${escapeHtml(formatDate(execution.started_at))} · Ended ${escapeHtml(formatDate(execution.ended_at))}</p>
        <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:22px;">
          ${[
            ["Pass rate", `${summary.pass_rate}%`, "pass"],
            ["Passed", summary.passed, "pass"],
            ["Failed", summary.failed, "fail"],
            ["Blocked", summary.blocked, "warn"],
            ["Duration", formatDuration(summary.duration_ms), "run"]
          ].map(([label, value, tone]) => `
            <div style="border:1px solid #dfe5ef;border-left:4px solid ${tone === "pass" ? "#159363" : tone === "fail" ? "#ce3f5f" : tone === "warn" ? "#be7a14" : "#4568dc"};border-radius:6px;padding:12px;background:#fbfcfe;">
              <div style="font-size:20px;font-weight:800;color:#101928;">${escapeHtml(value)}</div>
              <div style="font-size:12px;color:#536173;">${escapeHtml(label)}</div>
            </div>
          `).join("")}
        </div>
      </div>
      <div style="margin-top:18px;">
        ${report.cases.map((testCase) => `
          <div style="background:#ffffff;border:1px solid #dfe5ef;border-radius:8px;margin-bottom:12px;overflow:hidden;">
            <div style="padding:16px 18px;border-bottom:1px solid #edf1f7;display:flex;justify-content:space-between;gap:16px;">
              <div>
                <strong style="display:block;font-size:16px;color:#101928;">${escapeHtml(testCase.title)}</strong>
                <span style="font-size:13px;color:#536173;">${escapeHtml(testCase.suite_name || "Direct run")} · ${escapeHtml(formatDuration(testCase.duration_ms))}</span>
              </div>
              <span class="${statusClass(testCase.status)}" style="height:fit-content;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800;background:${testCase.status === "passed" ? "#e3f8ef;color:#107650" : testCase.status === "failed" ? "#ffe8ee;color:#a92748" : "#fff4de;color:#8a570f"};">${escapeHtml(testCase.status.toUpperCase())}</span>
            </div>
            ${testCase.error ? `<div style="padding:10px 18px;color:#a92748;background:#fff5f7;font-size:13px;">${escapeHtml(testCase.error)}</div>` : ""}
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#f8fafc;color:#536173;text-align:left;">
                  <th style="padding:10px 12px;border-bottom:1px solid #edf1f7;">Step</th>
                  <th style="padding:10px 12px;border-bottom:1px solid #edf1f7;">Action</th>
                  <th style="padding:10px 12px;border-bottom:1px solid #edf1f7;">Status</th>
                  <th style="padding:10px 12px;border-bottom:1px solid #edf1f7;">Evidence</th>
                </tr>
              </thead>
              <tbody>
                ${testCase.steps.map((step) => `
                  <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #edf1f7;">${escapeHtml(step.order)}</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #edf1f7;">
                      <div>${escapeHtml(step.action || "No action recorded")}</div>
                      ${step.note ? `<div style="margin-top:4px;color:#536173;">${escapeHtml(step.note)}</div>` : ""}
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #edf1f7;">${escapeHtml(String(step.status).toUpperCase())}</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #edf1f7;">${step.has_evidence ? "Image" : ""}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `).join("")}
      </div>
    </div>
  </body>
</html>`;
};

const pdfEscape = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const wrapLine = (line, max = 92) => {
  const words = String(line || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
};

const buildReportLines = (report) => {
  const lines = [
    `QAira Run Report: ${report.execution.name || report.execution.id}`,
    `Generated: ${formatDate(report.generated_at)}`,
    `Status: ${report.execution.status || "queued"}`,
    `Cases: ${report.summary.total} total, ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.blocked} blocked`,
    `Pass rate: ${report.summary.pass_rate}%`,
    `Duration: ${formatDuration(report.summary.duration_ms)}`,
    ""
  ];

  report.cases.forEach((testCase, index) => {
    lines.push(`${index + 1}. ${testCase.title} [${testCase.status}]`);
    if (testCase.error) {
      lines.push(`   Error: ${testCase.error}`);
    }
    testCase.steps.forEach((step) => {
      lines.push(`   Step ${step.order} ${String(step.type || "").toUpperCase()} [${step.status}]: ${step.action || "No action recorded"}`);
      if (step.note) {
        lines.push(`     ${step.note.replace(/\n+/g, " ")}`);
      }
    });
    lines.push("");
  });

  return lines.flatMap((line) => wrapLine(line));
};

const renderReportPdf = (report) => {
  const pages = [];
  let current = [];

  buildReportLines(report).forEach((line) => {
    if (current.length >= 48) {
      pages.push(current);
      current = [];
    }
    current.push(line);
  });

  if (current.length) {
    pages.push(current);
  }

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };
  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  pages.forEach((pageLines) => {
    const streamLines = ["BT", "/F1 10 Tf", "50 792 Td", "14 TL"];
    pageLines.forEach((line, index) => {
      streamLines.push(`${index === 0 ? "" : "T* "}(${pdfEscape(line)}) Tj`);
    });
    streamLines.push("ET");
    const stream = streamLines.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });

  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  offsets.slice(1).forEach((offset) => {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(""), "utf8");
};

const normalizeRecipients = (value) => {
  const entries = Array.isArray(value) ? value : String(value || "").split(/[,\n;]/);
  return [...new Set(entries.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))];
};

exports.buildReport = buildReportModel;

exports.renderReportHtml = async (executionId) => renderReportHtml(await buildReportModel(executionId));

exports.renderReportPdf = async (executionId) => renderReportPdf(await buildReportModel(executionId));

exports.emailReport = async ({ execution_id, recipients, requested_by } = {}) => {
  const normalizedRecipients = normalizeRecipients(recipients);

  if (!normalizedRecipients.length) {
    throw new Error("At least one report recipient is required");
  }

  const report = await buildReportModel(execution_id);
  const title = report.execution.name || "QAira execution run";
  const html = renderReportHtml(report);
  const text = buildReportLines(report).join("\n");

  await emailService.sendMail({
    to: normalizedRecipients,
    subject: `QAira run report: ${title}`,
    text,
    html
  });

  try {
    const transaction = await workspaceTransactionService.createTransaction({
      project_id: report.execution.project_id,
      app_type_id: report.execution.app_type_id || null,
      category: "reporting",
      action: "run_report_export",
      status: "completed",
      title: `Shared run report for ${title}`,
      description: `Sent HTML report to ${normalizedRecipients.length} recipient${normalizedRecipients.length === 1 ? "" : "s"}.`,
      metadata: {
        exported: 1,
        channel: "email",
        recipient_count: normalizedRecipients.length,
        execution_id
      },
      related_kind: "execution",
      related_id: execution_id,
      created_by: requested_by || null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });

    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "success",
      phase: "report.email.sent",
      message: `Run report emailed to ${normalizedRecipients.length} recipient${normalizedRecipients.length === 1 ? "" : "s"}.`,
      details: {
        execution_id,
        recipient_count: normalizedRecipients.length
      }
    });
  } catch {
    // Reporting audit events must not block email delivery.
  }

  return {
    sent: true,
    recipients: normalizedRecipients.length
  };
};
