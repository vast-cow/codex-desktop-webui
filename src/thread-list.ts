/** Drain the existing thread/list contract without manufacturing continuation tokens.
 * A response without nextCursor is the legacy, single-response fallback.
 */
export function threadListReader(send: (method: string, params: any) => Promise<any>) {
  const pending = new Map<string, Promise<any>>();
  return (params: any): Promise<any> => {
    const key = JSON.stringify(params);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const threads = new Map<string, any>();
      const seen = new Set<string>();
      let cursor = params.cursor ?? null;
      let result: any;
      do {
        if (cursor !== null) {
          if (seen.has(cursor)) throw Error('thread/list returned a repeated cursor');
          seen.add(cursor);
        }
        result = await send('thread/list', { ...params, cursor });
        if (!Array.isArray(result?.data)) throw Error('Invalid thread/list data');
        for (const thread of result.data) {
          if (typeof thread?.id !== 'string') throw Error('Invalid thread/list entry');
          const prior = threads.get(thread.id);
          if (!prior || thread.updatedAt > prior.updatedAt) threads.set(thread.id, thread);
        }
        cursor = result.nextCursor ?? null;
        if (cursor !== null && (typeof cursor !== 'string' || !cursor)) throw Error('Invalid thread/list cursor');
      } while (cursor !== null);
      const field = params.sortKey === 'created_at' ? 'createdAt' : 'updatedAt';
      return { ...result, data: [...threads.values()].sort((a, b) => b[field] - a[field] || a.id.localeCompare(b.id)), nextCursor: null };
    })();
    pending.set(key, request);
    void request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
    return request;
  };
}
