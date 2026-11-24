import { buildSelfInstallBundle } from "./self-install-bundle.js";

export type CompactSelfInstallSectionId = "network" | "vpn" | "services";

export interface CompactSelfInstallSection {
  id: CompactSelfInstallSectionId;
  tag: string;
  title: string;
  description: string;
  content: string;
}

export interface CompactSelfInstallFile extends Omit<CompactSelfInstallSection, "content"> {
  fileName: string;
  content: string;
  order: number;
}

const FILE_NAMES: Record<CompactSelfInstallSectionId, string> = {
  network: "self-install-network.rsc",
  vpn: "self-install-vpn.rsc",
  services: "self-install-services.rsc",
};

const EXPECTED_ORDER: CompactSelfInstallSectionId[] = ["network", "vpn", "services"];

/**
 * Split the full Self Install configuration into independently imported files.
 * Each file is still wrapped with the normal fail-fast bundle guard, but the
 * router only parses one subsystem at a time, which helps low-memory devices.
 */
export function buildCompactSelfInstallFiles(
  sections: CompactSelfInstallSection[],
): CompactSelfInstallFile[] {
  if (sections.length !== EXPECTED_ORDER.length) {
    throw new Error("Compact Self Install requires network, VPN, and services sections.");
  }

  return EXPECTED_ORDER.map((id, index) => {
    const section = sections[index];
    if (section.id !== id || !section.content.trim()) {
      throw new Error(`Compact Self Install section ${index + 1} must be ${id} and non-empty.`);
    }

    return {
      id: section.id,
      tag: section.tag,
      title: section.title,
      description: section.description,
      order: index + 1,
      fileName: FILE_NAMES[section.id],
      content: buildSelfInstallBundle([{ tag: section.tag, content: section.content }]),
    };
  });
}
