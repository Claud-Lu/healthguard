import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore } from './postgres';

// Exercises production SQL in PostgreSQL WASM without touching a deployed database.
describe('project rename persistence', () => {
  it('scopes updates to the owner and persists only the name across store restarts', async () => {
    const db = new PGlite();
    const query = async (sql: string, params: unknown[] = []) => {
      if (!params.length) {
        const results = await db.exec(sql);
        const result = results[results.length - 1];
        return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
      }
      const result = await db.query(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) };
    try {
      const store = await createPostgresStore({ pool: pool as never });
      await store.createUser({ id: 'owner', email: 'owner@example.com', passwordHash: '', createdAt: 1 });
      const project = { id: 'project', appKey: 'example-project', name: 'Generated', type: 'web' as const, ownerUserId: 'owner', createdAt: 1 };
      await store.createApp(project);
      expect(await store.renameApp(project.appKey, 'other', 'Unauthorized')).toBeNull();
      expect(await store.renameApp('missing', 'owner', 'Unknown')).toBeNull();
      expect(await store.renameApp(project.appKey, 'owner', "示例项目 ' <test>")).toEqual({ ...project, name: "示例项目 ' <test>" });
      const restarted = await createPostgresStore({ pool: pool as never });
      expect(await restarted.listAppsByUser('owner')).toEqual([{ ...project, name: "示例项目 ' <test>" }]);
    } finally { await db.close(); }
  }, 30000);
});
