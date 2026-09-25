function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * RouterOS and the customer database cannot share a transaction. Apply router
 * access first, then persist the row; compensate only when we can confirm that
 * the database still holds the old row. A failed database request may have
 * committed, so read it back before making another router change.
 */
export async function saveCustomerEditWithRouter<Row, RouterResult>(options: {
  applyRouter: (markMutation: () => void) => Promise<RouterResult>;
  restoreRouter: () => Promise<void>;
  saveRecord: () => Promise<Row>;
  readRecord: () => Promise<Row | undefined>;
  matchesRequested: (row: Row) => boolean;
  matchesBefore: (row: Row) => boolean;
  confirmedRejected: (error: unknown) => boolean;
}): Promise<{ row: Row; router: RouterResult }> {
  let routerMutationAttempted = false;
  const markMutation = () => { routerMutationAttempted = true; };
  const restore = async (failure: unknown): Promise<never> => {
    try {
      await options.restoreRouter();
    } catch (rollbackError) {
      throw new Error(
        `The edit failed: ${reason(failure)}. MikroTik could not be restored: ${reason(rollbackError)}. Administrator attention is required.`,
      );
    }
    throw new Error(`The edit was not saved and MikroTik was restored: ${reason(failure)}`);
  };

  let router: RouterResult;
  try {
    router = await options.applyRouter(markMutation);
  } catch (error) {
    if (routerMutationAttempted) return restore(error);
    throw new Error(`The edit was not saved because MikroTik could not be updated: ${reason(error)}`);
  }

  try {
    const row = await options.saveRecord();
    return { row, router };
  } catch (error) {
    let row: Row | undefined;
    try {
      row = await options.readRecord();
    } catch (readError) {
      throw new Error(
        `The database save could not be verified: ${reason(error)}; read-back failed: ${reason(readError)}. MikroTik may have changed. Administrator attention is required.`,
      );
    }
    if (row && options.matchesRequested(row)) return { row, router };
    if (!row || !options.matchesBefore(row) || !options.confirmedRejected(error)) {
      throw new Error(
        `The database save could not be confirmed: ${reason(error)}. MikroTik may have changed; refresh this user before retrying. Administrator attention is required if the two records differ.`,
      );
    }
    return restore(error);
  }
}