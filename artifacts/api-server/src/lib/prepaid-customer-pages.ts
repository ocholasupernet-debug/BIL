export async function collectIdPages<T extends { id: number }>(
  fetchPage: (lastId: number | null, pageSize: number) => Promise<T[]>,
  pageSize = 1000,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Page size must be a positive safe integer.");
  }

  const rows: T[] = [];
  let lastId: number | null = null;
  while (true) {
    const page = await fetchPage(lastId, pageSize);
    rows.push(...page);
    if (page.length < pageSize) return rows;

    const nextId = Number(page[page.length - 1]?.id);
    if (!Number.isSafeInteger(nextId) || (lastId !== null && nextId <= lastId)) {
      throw new Error("Paged records returned an invalid ID cursor.");
    }
    lastId = nextId;
  }
}
