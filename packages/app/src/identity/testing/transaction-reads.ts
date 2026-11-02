import { AsyncLocalStorage } from "node:async_hooks";
import type { Database, Transaction } from "#app/db/database.ts";

/**
 * PGlite has one connection. A hook using its base database during a transaction
 * otherwise queues behind its own transaction forever. PostgreSQL uses another
 * pool connection. Keep the real PGlite transaction, but route these test reads
 * to it. Do not use this facade to prove cross-connection visibility.
 */
export function withTransactionReads(database: Database): Database {
  const current = new AsyncLocalStorage<Transaction>();
  return new Proxy(database, {
    get(target, key) {
      if (key === "transaction") {
        return <T>(run: (tx: Transaction) => Promise<T>) =>
          target.transaction((tx) => current.run(tx, () => run(tx)));
      }
      const executor = current.getStore() ?? target;
      const value = Reflect.get(executor, key);
      return typeof value === "function" ? value.bind(executor) : value;
    },
  });
}
