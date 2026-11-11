export function buildSelfInstallBundle(
  sections: Array<{ tag: string; content: string }>,
): string {
  const body = sections.map((section, index) => {
    const tag = section.tag.replace(/[^A-Z0-9 _-]/gi, "").trim().toUpperCase();
    const label = `${index + 1}/${sections.length} ${tag}`;
    const errorVariable = `ocholaBundleError${index + 1}`;
    return `# >>> OCHOLASUPERNET ${label} >>>\n:local ${errorVariable} ""\n:do {\n${section.content.trim()}\n} on-error={\n    :do { :set ${errorVariable} $error } on-error={ :set ${errorVariable} "RouterOS returned an unspecified error" }\n}\n:if ([:len $${errorVariable}] > 0) do={\n    :put ("OCHOLASUPERNET bundle stopped at ${label}: " . $${errorVariable})\n    :error ("OCHOLASUPERNET bundle stopped at ${label}")\n}\n# <<< OCHOLASUPERNET ${label} <<<`;
  });
  return `# OcholaSupernet Self Install bundle\n# Contains the ordered network, management VPN, and customer service setup sections.\n# If a section reports an error, later sections are not run.\n\n${body.join("\n\n")}\n\n:put "OCHOLASUPERNET Self Install bundle completed."\n`;
}
