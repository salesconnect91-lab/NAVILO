export type RegisterExportPage = {rows: Array<Record<string, unknown>>; count: number; snapshot: string; totals: Record<string, number>};

// Every page must describe the same filtered dataset. Never mix page rows with
// stale totals, or silently finish on an unexpected empty/duplicate page.
export async function collectRegisterExport(
  read: (offset: number) => Promise<RegisterExportPage>,
  signal: AbortSignal,
  progress: (loaded: number, count: number) => void,
) {
  const rows: RegisterExportPage['rows'] = [];
  const ids = new Set<unknown>();
  let first: RegisterExportPage | undefined;
  for (let offset = 0; ; offset += 500) {
    signal.throwIfAborted();
    const page = await read(offset);
    signal.throwIfAborted();
    first ??= page;
    if (!page.snapshot || page.snapshot !== first.snapshot || page.count !== first.count || JSON.stringify(page.totals) !== JSON.stringify(first.totals)) {
      throw new Error('Trips changed during export. Refresh and export again.');
    }
    if (offset < page.count && page.rows.length === 0) throw new Error('Incomplete export page. No file was generated.');
    for (const row of page.rows) {
      if (!row.id || ids.has(row.id)) throw new Error('Duplicate or missing Trip identity in export.');
      ids.add(row.id); rows.push(row);
    }
    progress(rows.length, page.count);
    if (rows.length > page.count) throw new Error('Export row count changed.');
    if (rows.length === page.count) break;
  }
  const final = await read(0);
  signal.throwIfAborted();
  if (final.snapshot !== first.snapshot || final.count !== first.count) throw new Error('Trips changed before export completed. Refresh and export again.');
  return {rows, totals: first.totals};
}
