import { sbRpc } from "./supabase-client.js";

export const REGISTRATION_CONTACT_LIMIT_MESSAGE =
  "Unable to register with these contact details.";

export function isRegistrationContactLimitError(error: unknown): boolean {
  return String(error).includes("registration_contact_limit");
}

export async function checkRegistrationContactCapacity(
  email: string | null,
  phone: string | null,
): Promise<boolean> {
  const rows = await sbRpc<{ allowed: boolean }>(
    "registration_contact_capacity",
    { p_email: email, p_phone: phone },
  );
  if (rows.length !== 1 || typeof rows[0]?.allowed !== "boolean") {
    throw new Error("Registration contact capacity check returned no result.");
  }
  return rows[0].allowed;
}