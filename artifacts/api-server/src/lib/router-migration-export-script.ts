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

function rscEscape(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build the domain-connected collector. RouterOS needs a temporary file as
 * the bridge between `/export` and HTTP POST. RouterOS limits `http-data`
 * variables to roughly 4KB, so the file contents are sent in ordered chunks
 * and the server assembles them before parsing.
 */
export function buildDomainRouterExportScript(uploadUrl: string): string {
  const safeUploadUrl = rscEscape(uploadUrl);
  return `# OcholaSupernet domain-connected RouterOS migration collector
# Run this script on the ACTIVE/source MikroTik only.
# It reads the complete configuration with sensitive values, uploads it over
# HTTPS in small chunks to the one-time migration session, then removes its
# temporary file.
# It does not add, set, remove, enable, disable, reboot, or restart configuration.
:local exportFile "ochola-router-migration-export.rsc"
:do { /file remove [find name=$exportFile] } on-error={}
:do {
    /export show-sensitive terse file=$exportFile
    :local exportId [/file find name=$exportFile]
    :if ([:len $exportId] = 0) do={ :error "Export file was not created." }
    :local exportData [/file get $exportId contents]
    :local exportSize [/file get $exportId size]
    :if ($exportSize > [:len $exportData]) do={ :error "This RouterOS version cannot read an export larger than its script variable limit." }
    :local exportLength [:len $exportData]
    :local chunkSize 3500
    :local chunkIndex 0
    :local offset 0
    :while ($offset < $exportLength) do={
        :local chunkEnd ($offset + $chunkSize)
        :if ($chunkEnd > $exportLength) do={ :set chunkEnd $exportLength }
        :local chunk [:pick $exportData $offset $chunkEnd]
        :local finalChunk "no"
        :if ($chunkEnd = $exportLength) do={ :set finalChunk "yes" }
        /tool fetch url=("${safeUploadUrl}&chunk=" . $chunkIndex . "&final=" . $finalChunk) mode=https check-certificate=no http-method=post http-header-field="Content-Type:text/plain" http-data=$chunk keep-result=no
        :set offset $chunkEnd
        :set chunkIndex ($chunkIndex + 1)
    }
    :put "OcholaSupernet: router export uploaded successfully."
} on-error={
    :put "OcholaSupernet: router export upload failed. Re-run the collector to retry."
}
:do { /file remove [find name=$exportFile] } on-error={}
`;
}