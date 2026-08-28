/**
 * This is deliberately a command-only helper. It is not an installer and must
 * not be imported as a configuration change on the active/source router.
 *
 * RouterOS writes the export text to the terminal when `file=` is omitted.
 * The operator can copy that terminal output into a .rsc file for a later,
 * manually reviewed import on a replacement router.
 */
export const READ_ONLY_ROUTER_EXPORT_SCRIPT = `# OcholaSupernet read-only RouterOS migration export
# Run this command in the ACTIVE router terminal.
# It reads configuration only; it does not create a router file, upload data,
# restart the router, or change configuration.
# Copy the output from the terminal into a new .rsc file.
/export show-sensitive terse
`;