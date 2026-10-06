import type Database from "better-sqlite3";
import {
  createCurrentRepositoryContext,
  getCurrentRepositorySqlite,
} from "../database/repositories/factory.js";
import { resolveDatabaseDialect } from "../database/db/dialect.js";
import type { DatabaseContext } from "../database/repositories/database-context.js";

export interface CloudSshSqliteContext extends DatabaseContext {
  readonly sqlite: Database.Database;
}

/**
 * CloudSSH's legacy project/control-plane layer still has a few synchronous
 * SQLite transactions. Keep that limitation local to CloudSSH instead of
 * leaking a raw driver back into Termix's portable DatabaseContext.
 */
export function createCloudSshSqliteContext(): CloudSshSqliteContext {
  if (resolveDatabaseDialect() !== "sqlite") {
    throw new Error(
      "CloudSSH Agent/control-plane currently requires the SQLite database backend",
    );
  }
  return {
    ...createCurrentRepositoryContext(),
    sqlite: getCurrentRepositorySqlite(),
  };
}
