import postgres from "postgres";

export type Sql = postgres.Sql;

export function createDb(url: string): Sql {
  return postgres(url, { max: 10, idle_timeout: 30, onnotice: () => {} });
}
