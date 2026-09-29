import { Pool } from "pg";

const URL = "postgresql://b2:b2@localhost:5435/b2_dashboard";
export const pool = new Pool({ connectionString: URL, max: 3 });

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}
export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}
