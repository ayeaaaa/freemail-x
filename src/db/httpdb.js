class HttpStatement {
  constructor(env, sql) {
    this.env = env;
    this.originalSql = String(sql || '').trim();
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async execute() {
    const endpoint = String(this.env.DB_API_URL || '').trim();
    const token = String(this.env.DB_API_TOKEN || '').trim();
    if (!endpoint || !token) {
      throw new Error('未配置 DB_API_URL 或 DB_API_TOKEN');
    }
    const url = `${endpoint.replace(/\/$/, '')}/query`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ sql: this.originalSql, params: this.params })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      console.error('[httpdb] query failed', { url, status: response.status, error: data.error, sql: this.originalSql });
      throw new Error(data.error || `HTTP DB 请求失败: ${response.status}`);
    }
    return data;
  }

  async all() {
    const data = await this.execute();
    return {
      success: true,
      results: data.results || [],
      meta: data.meta || { changes: 0 }
    };
  }

  async first() {
    const data = await this.execute();
    return (data.results || [])[0] || null;
  }

  async run() {
    const data = await this.execute();
    return {
      success: true,
      meta: data.meta || { changes: 0 }
    };
  }
}

class HttpCompatDb {
  constructor(env) {
    this.env = env;
  }

  prepare(sql) {
    return new HttpStatement(this.env, sql);
  }

  async exec(sql) {
    const stmt = new HttpStatement(this.env, sql);
    await stmt.execute();
    return { success: true };
  }

  async batch(statements) {
    const results = [];
    for (const stmt of statements || []) {
      const current = new HttpStatement(this.env, stmt?.originalSql || stmt?.sql || '');
      current.bind(...(Array.isArray(stmt?.params) ? stmt.params : []));
      const data = await current.execute();
      results.push({ success: true, results: data.results || [], meta: data.meta || { changes: 0 } });
    }
    return results;
  }
}

export function createHttpCompatDb(env) {
  if (!globalThis.__HTTP_COMPAT_DB__) {
    globalThis.__HTTP_COMPAT_DB__ = new HttpCompatDb(env);
  }
  globalThis.__DB_BACKEND__ = 'httpdb';
  return globalThis.__HTTP_COMPAT_DB__;
}
