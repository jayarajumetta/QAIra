const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createFeedback = ({ user_id, title, message, status }) => {
  if (!user_id || !title || !message) {
    throw new Error("Missing required fields");
  }

  const user = db.prepare(`
    SELECT id
    FROM users
    WHERE id = ?
  `).get(user_id);

  if (!user) {
    throw new Error("User not found");
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO feedback (id, user_id, title, message, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, user_id, title, message, status || "open");

  return { id };
};

exports.getFeedback = ({ user_id, status } = {}) => {
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

exports.getFeedbackItem = (id) => {
  const item = db.prepare(`
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

exports.updateFeedback = (id, data) => {
  const existing = exports.getFeedbackItem(id);

  if (data.user_id && data.user_id !== existing.user_id) {
    const user = db.prepare(`
      SELECT id
      FROM users
      WHERE id = ?
    `).get(data.user_id);

    if (!user) {
      throw new Error("User not found");
    }
  }

  db.prepare(`
    UPDATE feedback
    SET user_id = ?, title = ?, message = ?, status = ?
    WHERE id = ?
  `).run(
    data.user_id ?? existing.user_id,
    data.title ?? existing.title,
    data.message ?? existing.message,
    data.status ?? existing.status,
    id
  );

  return { updated: true };
};

exports.deleteFeedback = (id) => {
  exports.getFeedbackItem(id);

  db.prepare(`
    DELETE FROM feedback
    WHERE id = ?
  `).run(id);

  return { deleted: true };
};
