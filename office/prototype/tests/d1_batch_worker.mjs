/**
 * Disposable local-D1-only contract probe.
 * Never expose this worker as a production route.
 */
export default {
  async fetch(_request, env) {
    await env.OFFICE_DB.exec(`
      CREATE TABLE IF NOT EXISTS _office_d1_batch_probe (
        id TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
    `);
    await env.OFFICE_DB.exec("DELETE FROM _office_d1_batch_probe");

    let batchRejected = false;
    try {
      await env.OFFICE_DB.batch([
        env.OFFICE_DB.prepare(
          "INSERT INTO _office_d1_batch_probe (id, value) VALUES (?, ?)"
        ).bind("duplicate", "first"),
        env.OFFICE_DB.prepare(
          "INSERT INTO _office_d1_batch_probe (id, value) VALUES (?, ?)"
        ).bind("duplicate", "second"),
      ]);
    } catch {
      batchRejected = true;
    }

    const afterFailure = await env.OFFICE_DB.prepare(
      "SELECT COUNT(*) AS count FROM _office_d1_batch_probe"
    ).first();

    await env.OFFICE_DB.batch([
      env.OFFICE_DB.prepare(
        "INSERT INTO _office_d1_batch_probe (id, value) VALUES (?, ?)"
      ).bind("valid-1", "one"),
      env.OFFICE_DB.prepare(
        "INSERT INTO _office_d1_batch_probe (id, value) VALUES (?, ?)"
      ).bind("valid-2", "two"),
    ]);

    const afterSuccess = await env.OFFICE_DB.prepare(
      "SELECT COUNT(*) AS count FROM _office_d1_batch_probe"
    ).first();

    const result = {
      batchRejected,
      rollbackVerified: afterFailure?.count === 0,
      successfulBatchVerified: afterSuccess?.count === 2,
    };
    const ok = Object.values(result).every(Boolean);
    return new Response(JSON.stringify({ ok, ...result }), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
};
