const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH, {
  verbose: console.log
});

db.pragma("foreign_keys = ON");

module.exports = db;