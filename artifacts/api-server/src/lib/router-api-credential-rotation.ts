export interface VerifiedApiCredentialRotationSteps<T> {
  createTemporaryAccount(): Promise<string>;
  verifyNewLogin(): Promise<T>;
  persistCredential(): Promise<void>;
  removeTemporaryAccount(accountId: string): Promise<void>;
}

/**
 * Create and verify a replacement API account before saving its password.
 * If verification or persistence fails, remove only the temporary account.
 */
export async function runVerifiedApiCredentialRotation<T>(
  steps: VerifiedApiCredentialRotationSteps<T>,
): Promise<T> {
  let accountId: string | undefined;

  try {
    accountId = await steps.createTemporaryAccount();
    if (!accountId) throw new Error("The new API account was not created.");

    const verified = await steps.verifyNewLogin();
    await steps.persistCredential();
    return verified;
  } catch {
    if (accountId) {
      try {
        await steps.removeTemporaryAccount(accountId);
      } catch {
        throw new Error(
          "Rotation failed and cleanup could not be confirmed. Check the router locally before retrying.",
        );
      }
    }
    throw new Error(
      "Rotation failed. Existing router credentials were not intentionally changed; verify API access and try again.",
    );
  }
}
