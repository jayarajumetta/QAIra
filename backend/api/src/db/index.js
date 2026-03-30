const { AsyncLocalStorage } = require("async_hooks");
const { Pool } = require("pg");

const transactionContext = new AsyncLocalStorage();

const resolveSsl = () => {
  if (process.env.PGSSL === "true") {
    return { rejectUnauthorized: false };
  }

  return false;
};

const resolvePoolConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: resolveSsl(),
      max: Number(process.env.DB_POOL_MAX || 10)
    };
  }

  return {
    host: process.env.PGHOST || process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
    user: process.env.PGUSER || process.env.POSTGRES_USER || "qaira",
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "qaira",
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || "qaira",
    ssl: resolveSsl(),
    max: Number(process.env.DB_POOL_MAX || 10)
  };
};

const pool = new Pool(resolvePoolConfig());

const toPgPlaceholders = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

const getExecutor = () => {
  return transactionContext.getStore()?.client || pool;
};

const query = async (sql, params = []) => {
  const executor = getExecutor();
  return executor.query(toPgPlaceholders(sql), params);
};

const prepare = (sql) => {
  return {
    async get(...params) {
      const result = await query(sql, params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await query(sql, params);
      return result.rows;
    },
    async run(...params) {
      const result = await query(sql, params);
      return {
        changes: result.rowCount
      };
    }
  };
};

const transaction = (callback) => {
  return async (...args) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await transactionContext.run({ client }, async () => {
        return callback(...args);
      });

      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
};

const close = async () => {
  await pool.end();
};

module.exports = {
  pool,
  query,
  prepare,
  transaction,
  close
};
