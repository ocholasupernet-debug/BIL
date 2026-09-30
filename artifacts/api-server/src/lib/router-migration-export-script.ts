export const READ_ONLY_ROUTER_EXPORT_SCRIPT = `# Read-only RouterOS migration preview.
# This prints a sensitive export to the terminal only; it does not create a router file.
/export show-sensitive terse
`;

function validateCollectorUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("A valid collector URL is required.");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.searchParams.has("token")) {
    throw new Error("The collector must use HTTPS and a one-time token.");
  }
  if (!url.pathname.endsWith("/router-migrations/collector-upload")) {
    throw new Error("The collector URL is not a RouterOS migration upload endpoint.");
  }
  return url;
}

export function buildDomainRouterExportScript(collectorUploadUrl: string): string {
  const baseUrl = validateCollectorUrl(collectorUploadUrl).toString().replace(/&$/, "");
  return `# Run the separate migration-tunnel script first, then run this one-time source export.
# The export is sensitive and remains encrypted by the migration service.
:local exportFile "ochola-migration-export.rsc"
:local exportFileId [/file find where name=$exportFile]
:if ([:len $exportFileId] > 0) do={ /file remove $exportFileId }
/export show-sensitive terse file=$exportFile
:delay 5s
:set exportFileId [/file find where name=$exportFile]
:if ([:len $exportFileId] = 0) do={ :error "RouterOS export file was not created." }
:local exportText [/file get $exportFileId contents]
:local exportLength [:len $exportText]
:if ($exportLength = 0) do={ /file remove $exportFileId; :error "RouterOS export was empty." }
:local exportFileSize [/file get $exportFileId size]
:if ($exportFileSize != $exportLength) do={ /file remove $exportFileId; :error "RouterOS export read was incomplete." }
:local chunkSize 3200
:local totalChunks (($exportLength + $chunkSize - 1) / $chunkSize)
:local chunkIndex 0
:do {
  :for offset from=0 to=($exportLength - 1) step=$chunkSize do={
    :local chunk [:pick $exportText $offset ($offset + $chunkSize)]
    :local isFinal "false"
    :if (($offset + $chunkSize) >= $exportLength) do={ :set isFinal "true" }
    :local uploadUrl ("${baseUrl}&chunk=" . $chunkIndex . "&total=" . $totalChunks . "&final=" . $isFinal)
    /tool fetch url=$uploadUrl http-method=post http-header-field="Content-Type: text/plain" http-data=$chunk mode=https check-certificate=yes output=none
    :set chunkIndex ($chunkIndex + 1)
    :delay 100ms
  }
} on-error={
  :do { /file remove $exportFileId } on-error={}
  :error "Migration upload failed; temporary export file removed."
}
/file remove $exportFileId
:put ("Migration export uploaded in " . $totalChunks . " encrypted chunk(s).")
`;
}