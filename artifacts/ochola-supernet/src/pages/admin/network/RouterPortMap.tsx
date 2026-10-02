import { useState } from "react";
import { Check, Plug, Wifi } from "lucide-react";

interface RouterInterface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  comment: string;
}

interface BridgeMembership {
  bridge: string;
  interface: string;
}

interface RouterPortMapProps {
  interfaces: RouterInterface[];
  bridgePorts: BridgeMembership[];
  selectedBridge: string;
  selectedPorts: Set<string>;
  onTogglePort: (name: string) => void;
}

const HARDWARE_PREFIX = /^(ether|wlan|wifi|sfp|combo|lte|bond)/i;
const HARDWARE_TYPE = /^(ether|ethernet|wlan|wifi|sfp|combo|lte|bond)/i;
const VIRTUAL_NAME = /(ovpn|vpn|proxy|vlan|loopback|bridge)/i;

function isPhysicalPort(iface: RouterInterface): boolean {
  const name = iface.name.trim();
  const type = iface.type.trim();
  return (
    iface.type !== "bridge"
    && iface.type !== "loopback"
    && !VIRTUAL_NAME.test(name)
    && HARDWARE_PREFIX.test(name)
    && (!type || HARDWARE_TYPE.test(type))
  );
}

function isSfpPort(iface: RouterInterface): boolean {
  return /sfp|combo/i.test(iface.name) || /sfp|combo/i.test(iface.type);
}

export function RouterPortMap({
  interfaces,
  bridgePorts,
  selectedBridge,
  selectedPorts,
  onTogglePort,
}: RouterPortMapProps) {
  const [showSfpPorts, setShowSfpPorts] = useState(false);
  const hardwarePorts = interfaces
    .filter(isPhysicalPort)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  const wanPort = hardwarePorts.find(iface => iface.name.toLowerCase() === "ether1");
  const sfpPorts = hardwarePorts.filter(isSfpPort);
  const visiblePorts = hardwarePorts.filter(iface =>
    iface.name.toLowerCase() === "ether1" || showSfpPorts || !isSfpPort(iface),
  );
  const hiddenSelectedSfpCount = sfpPorts.filter(
    iface => !showSfpPorts && selectedPorts.has(iface.name),
  ).length;

  return (
    <section
      aria-label="Live router port layout"
      style={{
        background: "var(--isp-card)",
        border: "1px solid var(--isp-border)",
        borderRadius: 12,
        padding: "0.9rem",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        flexWrap: "wrap",
        marginBottom: "0.75rem",
      }}>
        <div>
          <div style={{
            color: "var(--isp-text)",
            fontSize: "0.82rem",
            fontWeight: 800,
          }}>
            Live router ports
          </div>
          <div style={{
            color: "var(--isp-text-muted)",
            fontSize: "0.68rem",
            marginTop: "0.15rem",
          }}>
            Select ports for {selectedBridge || "the selected bridge"}.
          </div>
        </div>
        {sfpPorts.length > 0 && (
          <label style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45rem",
            color: "var(--isp-text-muted)",
            fontSize: "0.72rem",
            fontWeight: 700,
            cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={showSfpPorts}
              onChange={event => setShowSfpPorts(event.target.checked)}
              style={{ accentColor: "#34d399" }}
            />
            Show SFP ports ({sfpPorts.length})
          </label>
        )}
      </div>

      <div style={{
        border: "1px solid rgba(148,163,184,0.24)",
        borderRadius: 10,
        padding: "0.8rem",
        background: "linear-gradient(155deg,#26313d 0%,#141b25 72%)",
        boxShadow: "inset 0 1px rgba(255,255,255,0.08), 0 8px 22px rgba(0,0,0,0.18)",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          padding: "0 0.2rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
            <span style={{
              color: "#f8fafc",
              fontSize: "0.78rem",
              fontWeight: 900,
              letterSpacing: "0.035em",
            }}>
              MikroTik
            </span>
            <span style={{ color: "#94a3b8", fontSize: "0.63rem" }}>
              RouterOS · live interface layout
            </span>
          </div>
          <div aria-hidden="true" style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 7px #34d399" }} />
            <span style={{ color: "#94a3b8", fontSize: "0.58rem", fontWeight: 700 }}>API</span>
          </div>
        </div>

        {visiblePorts.length === 0 ? (
          <div style={{
            padding: "1rem",
            border: "1px dashed rgba(148,163,184,0.28)",
            borderRadius: 8,
            color: "#cbd5e1",
            fontSize: "0.75rem",
            textAlign: "center",
          }}>
            No assignable physical interfaces were returned by this router.
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(84px,1fr))",
            gap: "0.5rem",
          }}>
            {visiblePorts.map(iface => {
              const isWan = iface.name.toLowerCase() === "ether1";
              const selected = !isWan && selectedPorts.has(iface.name);
              const currentBridge = bridgePorts.find(
                member => member.interface === iface.name,
              )?.bridge;
              const borderColor = isWan
                ? "rgba(248,113,113,0.75)"
                : selected
                  ? "rgba(74,222,128,0.85)"
                  : "rgba(148,163,184,0.3)";
              const background = isWan
                ? "linear-gradient(160deg,rgba(127,29,29,0.82),rgba(69,10,10,0.9))"
                : selected
                  ? "linear-gradient(160deg,rgba(22,101,52,0.72),rgba(5,46,22,0.88))"
                  : "linear-gradient(160deg,rgba(51,65,85,0.8),rgba(15,23,42,0.92))";

              return (
                <button
                  key={iface.name}
                  type="button"
                  disabled={isWan}
                  aria-pressed={selected}
                  aria-label={isWan
                    ? `${iface.name}, WAN port, locked`
                    : `${selected ? "Remove" : "Assign"} ${iface.name} ${selected ? "from" : "to"} ${selectedBridge || "the selected bridge"}`}
                  title={isWan
                    ? `${iface.name} is reserved for WAN and cannot be selected.`
                    : currentBridge
                      ? `${iface.name} · currently on ${currentBridge}`
                      : `${iface.name} · unassigned`}
                  onClick={() => onTogglePort(iface.name)}
                  style={{
                    minWidth: 0,
                    minHeight: 82,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.3rem",
                    padding: "0.45rem 0.3rem",
                    border: `1px solid ${borderColor}`,
                    borderRadius: 7,
                    background,
                    color: "#f8fafc",
                    cursor: isWan ? "not-allowed" : "pointer",
                    opacity: isWan ? 0.92 : 1,
                    fontFamily: "inherit",
                    transition: "border-color 0.15s, transform 0.15s, background 0.15s",
                  }}
                >
                  <span style={{
                    width: 35,
                    height: 23,
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${isWan ? "rgba(252,165,165,0.65)" : "rgba(203,213,225,0.45)"}`,
                    borderRadius: 4,
                    background: "#090e16",
                    boxShadow: "inset 0 2px 5px rgba(0,0,0,0.75)",
                  }}>
                    <span style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4,3px)",
                      gap: 2,
                    }}>
                      {Array.from({ length: 8 }, (_, index) => (
                        <span
                          key={index}
                          style={{
                            width: 3,
                            height: 3,
                            borderRadius: 1,
                            background: isWan ? "#fca5a5" : selected ? "#86efac" : "#94a3b8",
                          }}
                        />
                      ))}
                    </span>
                    <span style={{
                      position: "absolute",
                      right: 3,
                      top: 3,
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: iface.running ? "#4ade80" : "#475569",
                    }} />
                  </span>
                  <code style={{
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "#f8fafc",
                    fontSize: "0.7rem",
                    fontWeight: 800,
                  }}>
                    {iface.name}
                  </code>
                  <span style={{
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: isWan ? "#fecaca" : selected ? "#bbf7d0" : "#cbd5e1",
                    fontSize: "0.54rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.025em",
                  }}>
                    {isWan ? "WAN · locked" : selected ? "Selected" : currentBridge || "Available"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.4rem 0.8rem",
        marginTop: "0.65rem",
        color: "var(--isp-text-muted)",
        fontSize: "0.64rem",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Check size={11} style={{ color: "#4ade80" }} /> Green = selected for {selectedBridge || "this bridge"}
        </span>
        {wanPort && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Plug size={11} style={{ color: "#f87171" }} /> ether1 is WAN and cannot be selected
          </span>
        )}
        {hardwarePorts.some(iface => /^(wlan|wifi)/i.test(iface.name)) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Wifi size={11} style={{ color: "#60a5fa" }} /> Wireless interfaces are included
          </span>
        )}
        {hiddenSelectedSfpCount > 0 && (
          <span style={{ color: "#fbbf24" }}>
            {hiddenSelectedSfpCount} selected SFP port{hiddenSelectedSfpCount === 1 ? "" : "s"} hidden
          </span>
        )}
        <span>Leave a port unselected for direct router access.</span>
      </div>
    </section>
  );
}

export default RouterPortMap;