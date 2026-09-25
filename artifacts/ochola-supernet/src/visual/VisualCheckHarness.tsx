import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import AdminDashboard from "@/pages/admin/Dashboard";
import ResellerWorkspace from "@/pages/admin/ResellerWorkspace";
import SuperAdminStorage from "@/pages/super-admin/Storage";
import { createVisualFixtureFetch } from "./fixtures";

type VisualPage = "admin-dashboard" | "reseller-dashboard" | "storage";
type CheckResult = { status: "pending" | "passed" | "failed"; errors: string[] };

const storageKeys = [
  "ochola_admin_id",
  "ochola_admin_username",
  "ochola_admin_name",
  "ochola_admin_display_name",
  "ochola_admin_role",
  "ochola_api_token",
  "ochola_superadmin_token",
  "ochola_superadmin_name",
  "ochola_superadmin_issued_at",
  "isp-theme",
];

function installFixtures(page: VisualPage) {
  const previousValues = new Map(storageKeys.map(key => [key, localStorage.getItem(key)]));
  const previousFetch = window.fetch;
  const previousThemeAttribute = document.documentElement.getAttribute("data-theme");

  localStorage.setItem("ochola_admin_id", "5");
  localStorage.setItem("ochola_admin_username", "visual-check");
  localStorage.setItem("ochola_admin_name", "Visual Fixture");
  localStorage.setItem("ochola_admin_display_name", "Visual Fixture");
  localStorage.setItem("ochola_admin_role", page === "reseller-dashboard" ? "reseller" : page === "storage" ? "superadmin" : "isp_admin");
  localStorage.setItem("ochola_api_token", "local-visual-fixture");
  localStorage.setItem("ochola_superadmin_token", "local-visual-fixture");
  localStorage.setItem("ochola_superadmin_name", "Visual Fixture");
  localStorage.setItem("ochola_superadmin_issued_at", String(Date.now()));
  window.fetch = createVisualFixtureFetch(page);

  return () => {
    window.fetch = previousFetch;
    previousValues.forEach((value, key) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    if (previousThemeAttribute === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previousThemeAttribute);
    delete document.documentElement.dataset.visualHarness;
  };
}

function checkTooltip(page: VisualPage): boolean {
  if (page === "admin-dashboard") {
    return document.querySelectorAll(".customer-chart g > title").length >= 12;
  }
  if (page === "reseller-dashboard") {
    return document.querySelectorAll(".reseller-chart-bar[title]").length >= 12;
  }

  const chart = document.querySelector<HTMLElement>(".storage-page .recharts-wrapper");
  const tooltip = document.querySelector<HTMLElement>(".storage-page .recharts-tooltip-wrapper");
  if (!chart || !tooltip) return false;
  const bounds = chart.getBoundingClientRect();
  if (bounds.width < 100 || bounds.height < 100) return false;

  for (const xRatio of [0.2, 0.5, 0.8]) {
    chart.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientX: bounds.left + bounds.width * xRatio,
      clientY: bounds.top + bounds.height * 0.45,
    }));
  }
  return Boolean(tooltip.textContent?.trim());
}

function runChecks(page: VisualPage, expectedTheme: "light" | "dark"): CheckResult {
  const errors: string[] = [];
  const root = document.documentElement;
  const isDark = root.getAttribute("data-theme") === "dark";
  if (isDark !== (expectedTheme === "dark")) errors.push(`Expected ${expectedTheme} theme.`);

  const pageNode = document.querySelector(
    page === "admin-dashboard" ? ".dashboard-page"
      : page === "reseller-dashboard" ? ".reseller-dashboard"
        : ".storage-page",
  );
  if (!pageNode) return { status: "pending", errors };

  if (page === "admin-dashboard") {
    const revenueCards = document.querySelectorAll(".dashboard-kpi").length;
    const networkCards = document.querySelectorAll(".dashboard-stat").length;
    if (revenueCards < 4) return { status: "pending", errors };
    if (networkCards < 8) return { status: "pending", errors };
    if (document.querySelector(".dashboard-error")) errors.push("Admin dashboard fixture requests failed.");
    if (!checkTooltip(page)) errors.push("Monthly customer bars are missing tooltip labels.");
  } else if (page === "reseller-dashboard") {
    const cards = document.querySelectorAll(".reseller-stat-card").length;
    if (!document.querySelector(".reseller-page-header h1")?.textContent?.trim() || cards < 8) {
      return { status: "pending", errors };
    }
    if (document.querySelector(".reseller-dashboard [role=alert]")) errors.push("Reseller dashboard fixture requests failed.");
    if (!checkTooltip(page)) errors.push("Reseller chart bars are missing tooltip labels.");
  } else {
    const cards = document.querySelectorAll(".storage-stat-card").length;
    if (cards < 4 || document.querySelector(".storage-page .recharts-line") === null) {
      return { status: "pending", errors };
    }
    if (document.querySelector(".storage-page [style*='Storage report unavailable']")) {
      errors.push("Storage fixture request failed.");
    }
    if (!checkTooltip(page)) {
      return { status: "pending", errors: [...errors, "Storage chart tooltip content did not appear on hover."] };
    }
  }

  if (document.documentElement.scrollWidth > window.innerWidth + 2) {
    errors.push(`Page overflows horizontally (${document.documentElement.scrollWidth}px > ${window.innerWidth}px).`);
  }

  const grid = document.querySelector<HTMLElement>(
    page === "admin-dashboard" ? ".dashboard-kpi-grid"
      : page === "reseller-dashboard" ? ".reseller-stat-grid"
        : ".storage-stat-grid",
  );
  if (grid) {
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    if (window.innerWidth <= 520 && columns > 2) errors.push(`Mobile metric grid has ${columns} columns.`);
    if (window.innerWidth >= 1024 && columns < 3) errors.push(`Desktop metric grid has only ${columns} columns.`);
  }

  return { status: errors.length ? "failed" : "passed", errors };
}

export default function VisualCheckHarness() {
  const [page] = useState(() => {
    const candidate = window.location.pathname.split("/").filter(Boolean).at(-1);
    return candidate === "reseller-dashboard" || candidate === "storage" || candidate === "admin-dashboard"
      ? candidate as VisualPage
      : "admin-dashboard";
  });
  const requestedTheme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
  const { theme, isDark, toggle } = useTheme();
  const activeTheme = useRef(isDark);
  activeTheme.current = isDark;
  const [check, setCheck] = useState<CheckResult>({ status: "pending", errors: [] });
  const [restore] = useState(() => installFixtures(page));

  useEffect(() => {
    if (theme !== requestedTheme) {
      toggle();
      return;
    }
    if (requestedTheme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    document.documentElement.dataset.visualHarness = "true";

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const result = runChecks(page, requestedTheme);
      if (result.status !== "pending" || Date.now() - startedAt > 12_000) {
        setCheck(result.status === "pending"
          ? { status: "failed", errors: ["Fixture-backed page did not finish rendering within 12 seconds.", ...result.errors] }
          : result);
        if (result.status !== "pending") window.clearInterval(timer);
      }
    }, 100);

    return () => {
      window.clearInterval(timer);
      restore();
      const originalTheme = localStorage.getItem("isp-theme") === "dark";
      if (activeTheme.current !== originalTheme) toggle();
    };
  }, [page, requestedTheme, restore, theme, toggle]);

  const Component = page === "admin-dashboard"
    ? AdminDashboard
    : page === "reseller-dashboard" ? ResellerWorkspace : SuperAdminStorage;

  return (
    <>
      <div style={{ display: "contents" }} data-visual-page={page}>
        <Component />
      </div>
      <output
        data-visual-status={check.status}
        data-visual-errors={check.errors.join(" | ")}
        aria-live="polite"
        style={{ display: "none" }}
      />
    </>
  );
}