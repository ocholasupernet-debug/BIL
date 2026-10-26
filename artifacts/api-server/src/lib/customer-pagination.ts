export interface CustomerCursorPage<T> {
  customers: T[];
  nextCursor: number | null;
  hasMore: boolean;
}

export async function collectCustomerCursorPage<T extends {
  id: number;
  archived_at?: string | null;
}>(
  fetchBatch: (beforeId: number | null, limit: number) => Promise<T[]>,
  options: {
    pageSize: number;
    beforeId: number | null;
    includeArchived: boolean;
    batchSize: number;
    maxBatches?: number;
  },
): Promise<CustomerCursorPage<T>> {
  const { pageSize, includeArchived, batchSize } = options;
  const maxBatches = options.maxBatches ?? 10;
  if (
    !Number.isSafeInteger(pageSize) || pageSize < 1
    || !Number.isSafeInteger(batchSize) || batchSize < pageSize
    || !Number.isSafeInteger(maxBatches) || maxBatches < 1
  ) {
    throw new Error("Invalid customer pagination bounds.");
  }

  const customers: T[] = [];
  let cursor = options.beforeId;
  let hasMore = false;

  for (let batchNumber = 0; batchNumber < maxBatches; batchNumber += 1) {
    const batch = await fetchBatch(cursor, batchSize);
    if (batch.length === 0) {
      return { customers, nextCursor: null, hasMore: false };
    }

    for (let index = 0; index < batch.length; index += 1) {
      const row = batch[index];
      if (!Number.isSafeInteger(row.id) || (cursor !== null && row.id >= cursor)) {
        throw new Error("Customer pagination returned an invalid or unordered cursor.");
      }
      cursor = row.id;
      if (Boolean(row.archived_at) === includeArchived) customers.push(row);
      if (customers.length === pageSize) {
        hasMore = index < batch.length - 1 || batch.length === batchSize;
        return {
          customers,
          nextCursor: hasMore ? cursor : null,
          hasMore,
        };
      }
    }

    if (batch.length < batchSize) {
      return { customers, nextCursor: null, hasMore: false };
    }
    hasMore = true;
  }

  return { customers, nextCursor: hasMore ? cursor : null, hasMore };
}
