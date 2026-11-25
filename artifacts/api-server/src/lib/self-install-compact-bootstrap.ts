import { ISRG_ROOT_X1_PEM, routerOsTextVariableWriter } from "./router-https-trust.js";
import type { CompactSelfInstallSectionId } from "./self-install-compact-plan.js";

export interface CompactSelfInstallBootstrapStage {
  id: CompactSelfInstallSectionId;
  fileName: string;
  sourceUrl: string;
}

const EXPECTED_ORDER: CompactSelfInstallSectionId[] = ["network", "vpn", "services"];
const EXPECTED_FILE_BASES: Record<CompactSelfInstallSectionId, string> = {
  network: "networksetup",
  vpn: "vpnsetup",
  services: "servicessetup",
};

function validateStage(stage: CompactSelfInstallBootstrapStage, expectedId: CompactSelfInstallSectionId): void {
  if (stage.id !== expectedId) {
    throw new Error(`Compact Self Install bootstrap stage must be ${expectedId}.`);
  }

  const expectedPrefix = `${EXPECTED_FILE_BASES[expectedId]}-`;
  if (!stage.fileName.startsWith(expectedPrefix) || !/^[A-Za-z0-9._-]+\.rsc$/.test(stage.fileName)) {
    throw new Error(`Compact Self Install ${expectedId} filename is invalid.`);
  }

  let source: URL;
  try {
    source = new URL(stage.sourceUrl);
  } catch {
    throw new Error(`Compact Self Install ${expectedId} source must be a valid HTTPS URL.`);
  }
  if (source.protocol !== "https:" || source.username || source.password) {
    throw new Error(`Compact Self Install ${expectedId} source must use HTTPS without embedded credentials.`);
  }
}

/**
 * Build the small file an administrator uploads manually to RouterOS.
 * It installs the public HTTPS trust anchor first, then downloads and imports
 * each signed, router-specific stage in order. Successfully downloaded stage
 * files are intentionally kept in RouterOS Files for inspection and recovery.
 */
export function buildCompactSelfInstallBootstrap(
  stages: CompactSelfInstallBootstrapStage[],
): string {
  if (stages.length !== EXPECTED_ORDER.length) {
    throw new Error("Compact Self Install bootstrap requires network, VPN, and services stages.");
  }
  stages.forEach((stage, index) => validateStage(stage, EXPECTED_ORDER[index]));

  const stageImports = stages.map(stage => `
:set ocholaStage "${stage.id}"
:set ocholaStageError ""
:do {
    /tool fetch url="${stage.sourceUrl}" dst-path="${stage.fileName}" mode=https check-certificate=yes
    :delay 2s
    :if ([:len [/file find where name="${stage.fileName}"]] = 0) do={
        :error "RouterOS did not create the downloaded stage file."
    }
    /import "${stage.fileName}"
} on-error={
    :set ocholaStageError $error
}
:if ([:len $ocholaStageError] > 0) do={
    :error ("[OCHOLA] " . $ocholaStage . " stage failed; its file was kept for diagnosis. Regenerate the bootstrap if its signed link expired: " . $ocholaStageError)
}`).join("\n");

  const httpsRootWriter = routerOsTextVariableWriter(ISRG_ROOT_X1_PEM, "ocholaHttpsCa", "    ");

  return `# OCHOLASUPERNET compact Self Install bootstrap
# Upload this small file to RouterOS, then import it.
# It trusts HTTPS, downloads the ordered stages, and imports each one.
# Router-specific stage files remain in Files for review and recovery.

:local ocholaStage "HTTPS certificate setup"
:local ocholaRootError ""
:if ([:len [/certificate find where common-name="ISRG Root X1"]] = 0) do={
${httpsRootWriter}
    :do {
        :do { /file remove [find where name="ochola-isrg-root-x1-bootstrap.txt"] } on-error={}
        /file print file="ochola-isrg-root-x1-bootstrap"
        :delay 1s
        /file set [find where name="ochola-isrg-root-x1-bootstrap.txt"] contents=$ocholaHttpsCa
    } on-error={
        :set ocholaRootError $error
    }
    :if ([:len $ocholaRootError] > 0) do={
        :error ("[OCHOLA] Could not prepare the HTTPS root certificate file: " . $ocholaRootError)
    }
    :set ocholaRootError ""
    :do {
        /certificate import file-name="ochola-isrg-root-x1-bootstrap.txt" passphrase=""
    } on-error={
        :set ocholaRootError $error
    }
    :if ([:len $ocholaRootError] > 0) do={
        :error ("[OCHOLA] Could not import the HTTPS root certificate: " . $ocholaRootError)
    }
}
:if ([:len [/certificate find where common-name="ISRG Root X1"]] = 0) do={
    :error "[OCHOLA] ISRG Root X1 was not found after import; no remote stages were fetched."
}
:do {
    /certificate set [find where common-name="ISRG Root X1"] trusted=yes
} on-error={
    :error ("[OCHOLA] Could not trust ISRG Root X1: " . $error)
}
:do { /file remove [find where name="ochola-isrg-root-x1-bootstrap.txt"] } on-error={}
:local ocholaStageError ""
${stageImports}
:put "[OCHOLA] Network, VPN/API, and service stages completed. Stage files remain in Files; remove them after review."`;
}
