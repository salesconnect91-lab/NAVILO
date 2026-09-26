export type PageResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

export async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number
  ) => PromiseLike<PageResult<T>>,
  pageSize = 1000
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive integer.");
  }

  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);

    if (result.error) {
      throw new Error(result.error.message || "Unable to load all report rows.");
    }

    const page = result.data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

export async function fetchByIdChunks<T>(
  ids: string[],
  fetchChunk: (ids: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = 200,
  pageSize = 1000
): Promise<T[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const result: T[] = [];

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);

    const rows = await fetchAllPages<T>(
      (from, to) => fetchChunk(chunk, from, to),
      pageSize
    );

    result.push(...rows);
  }

  return result;
}
