const db = require("../db");
const { v4: uuid } = require("uuid");
const { FEEDBACK_STATUS_VALUES, DOMAIN_METADATA } = require("../domain/catalog");

const DEFAULT_FEEDBACK_STATUS = DOMAIN_METADATA.feedback.default_status;

const normalizeStatus = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_FEEDBACK_STATUS;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return DEFAULT_FEEDBACK_STATUS;
  }

  if (!FEEDBACK_STATUS_VALUES.includes(normalized)) {
    throw new Error("Invalid feedback status");
  }

  return normalized;
};

exports.createFeedback = async ({ user_id, title, message, status }) => {
  if (!user_id || !title || !message) {
    throw new Error("Missing required fields");
  }

  const user = await db.prepare(`
    SELECT id
    FROM users
    WHERE id = ?
  `).get(user_id);

  if (!user) {
    throw new Error("User not found");
  }

  const id = uuid();

  await db.prepare(`
    INSERT INTO feedback (id, user_id, title, message, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, user_id, title, message, normalizeStatus(status));

  return { id };
};

exports.getFeedback = async ({ user_id, status } = {}) => {
  let query = `
    SELECT feedback.*, users.name AS user_name, users.email AS user_email
    FROM feedback
    JOIN users ON users.id = feedback.user_id
    WHERE 1 = 1
  `;
  const params = [];

  if (user_id) {
    query += ` AND feedback.user_id = ?`;
    params.push(user_id);
  }

  if (status) {
    query += ` AND feedback.status = ?`;
    params.push(status);
  }

  query += ` ORDER BY feedback.created_at DESC`;

  return db.prepare(query).all(...params);
};

exports.getFeedbackItem = async (id) => {
  const item = await db.prepare(`
    SELECT feedback.*, users.name AS user_name, users.email AS user_email
    FROM feedback
    JOIN users ON users.id = feedback.user_id
    WHERE feedback.id = ?
  `).get(id);

  if (!item) {
    throw new Error("Feedback not found");
  }

  return item;
};

exports.updateFeedback = async (id, data) => {
  const existing = await exports.getFeedbackItem(id);

  if (data.user_id && data.user_id !== existing.user_id) {
    const user = await db.prepare(`
      SELECT id
      FROM users
      WHERE id = ?
    `).get(data.user_id);

    if (!user) {
      throw new Error("User not found");
    }
  }

  await db.prepare(`
    UPDATE feedback
    SET user_id = ?, title = ?, message = ?, status = ?
    WHERE id = ?
  `).run(
    data.user_id ?? existing.user_id,
    data.title ?? existing.title,
    data.message ?? existing.message,
    data.status !== undefined ? normalizeStatus(data.status) : existing.status,
    id
  );

  return { updated: true };
};

exports.deleteFeedback = async (id) => {
  await exports.getFeedbackItem(id);

  await db.prepare(`
    DELETE FROM feedback
    WHERE id = ?
  `).run(id);

  return { deleted: true };
};
