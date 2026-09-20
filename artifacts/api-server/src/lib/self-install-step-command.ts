export interface SelfInstallStepCommandOptions {
  routerId: number;
  stepId: "network" | "vpn" | "services";
  stepOrder: 1 | 2 | 3;
  sourceUrl: string;
  fileName: string;
  verified?: boolean;
}

const STEP_DESCRIPTORS = [
  { id: "network", order: 1, label: "network engine" },
  { id: "vpn", order: 2, label: "management VPN/API" },
  { id: "services", order: 3, label: "Hotspot and PPPoE services" },
] as const;

/**
 * Build the terminal command shown for one Self Install file.
 *
 * Each command owns a small RouterOS marker pair. A completed marker makes
 * retries skip that step; a failed marker remains visible in the status
 * summary while the downloaded script is preserved for diagnosis.
 */
export function buildSelfInstallStepCommand({
  routerId,
  stepId,
  stepOrder,
  sourceUrl,
  fileName,
  verified = false,
}: SelfInstallStepCommandOptions): string {
  const markerPrefix = `ochola-self-install-${routerId}-step-${stepOrder}`;
  const doneBase = `${markerPrefix}-done`;
  const doneFile = `${doneBase}.txt`;
  const failedBase = `${markerPrefix}-failed`;
  const failedFile = `${failedBase}.txt`;
  const statusSummary = STEP_DESCRIPTORS.map(step => {
    const stepPrefix = `ochola-self-install-${routerId}-step-${step.order}`;
    return `:if ([:len [/file find where name="${stepPrefix}-done.txt"]] > 0) do={
    :put "[OCHOLA] Step ${step.order}/3 (${step.label}): COMPLETED"
} else={
    :if ([:len [/file find where name="${stepPrefix}-failed.txt"]] > 0) do={
        :put "[OCHOLA] Step ${step.order}/3 (${step.label}): FAILED (will retry)"
    } else={
        :put "[OCHOLA] Step ${step.order}/3 (${step.label}): PENDING"
    }
}`;
  }).join("\n");

  return `# OcholaSupernet Self Install Step ${stepOrder}/3 - ${stepId}
# A completed step is skipped on retry. Failed steps remain available for diagnosis.
:local ocholaStepError ""
:put "[OCHOLA] Current Self Install status:"
${statusSummary}
:if ([:len [/file find where name="${doneFile}"]] > 0) do={
    :put "[OCHOLA] Step ${stepOrder}/3 SKIPPED - already completed."
} else={
    :put "[OCHOLA] Step ${stepOrder}/3 STARTING - downloading and importing ${fileName}."
    :do {
        /tool fetch url="${sourceUrl}" dst-path="${fileName}" mode=https check-certificate=${verified ? "yes" : "no"}
        :delay 2s
        /import "${fileName}"
        /file remove "${fileName}"
    } on-error={
        :do { :set ocholaStepError $error } on-error={
            :set ocholaStepError "RouterOS returned an unspecified error"
        }
    }
    :if ([:len $ocholaStepError] > 0) do={
        :do { /file remove [find where name="${doneFile}"] } on-error={}
        :do {
            /file remove [find where name="${failedFile}"]
            /file print file="${failedBase}"
            :delay 1s
            /file set [find where name="${failedFile}"] contents=("failed: " . $ocholaStepError)
        } on-error={}
        :put ("[OCHOLA] Step ${stepOrder}/3 FAILED: " . $ocholaStepError)
        :put "[OCHOLA] The downloaded ${fileName} was preserved for diagnosis. Repair the cause, then rerun this step."
    } else={
        :do { /file remove [find where name="${failedFile}"] } on-error={}
        :do {
            /file print file="${doneBase}"
            :delay 1s
            /file set [find where name="${doneFile}"] contents="completed"
        } on-error={
            :put "[OCHOLA] Step completed, but its retry marker could not be saved; a later retry may run it again."
        }
        :put "[OCHOLA] Step ${stepOrder}/3 COMPLETED successfully."
    }
}
:put "[OCHOLA] Self Install status after Step ${stepOrder}/3:"
${statusSummary}
`;
}