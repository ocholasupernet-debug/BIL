import { useEffect } from "react";
import { ArrowRight, BookOpen, LogOut, Router, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { useEmployeeLogout, useEmployeeMe } from "@workspace/api-client-react";
import { personalizedStaffPath } from "../employee/staff-routes";

export default function TechnicianDashboard() {
  const [, setLocation] = useLocation();
  const me = useEmployeeMe();
  const logout = useEmployeeLogout();
  const employee = me.data?.employee;

  useEffect(() => {
    if (me.isLoading) return;
    if (!employee) {
      setLocation("/staff/login");
      return;
    }
    if (employee.accountType !== "technician") {
      setLocation(personalizedStaffPath(employee.username, "dashboard") ?? "/staff/dashboard");
    }
  }, [employee, me.isLoading, setLocation]);

  if (me.isLoading || !employee || employee.accountType !== "technician") {
    return <main className="tl-page"><div className="tl-content" role="status">Checking Technician access…</div></main>;
  }

  const learningPath = personalizedStaffPath(employee.username, "learning") ?? "/staff/learning";
  const signOut = () => logout.mutate(undefined, {
    onSuccess: () => setLocation("/staff/login"),
    onError: () => setLocation("/staff/login"),
  });

  return <main className="tl-page">
    <header className="tl-topbar">
      <div className="tl-brand" aria-label="ISPlatty Staff">
        <span className="tl-brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span className="tl-brand-copy"><strong>ISPlatty</strong><small>STAFF PORTAL</small></span>
      </div>
      <button type="button" className="tl-signout" onClick={signOut} disabled={logout.isPending}>
        <LogOut size={14} /> {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
    </header>
    <div className="tl-content">
      <p className="tl-kicker">Authenticated Technician account</p>
      <section className="tl-detail-hero">
        <p className="tl-kicker">Field operations · Staff workspace</p>
        <h1>Welcome, {employee.displayName.split(" ")[0]}.</h1>
        <p>Open the published Learning Center for approved router, Wi-Fi and fiber field guidance.</p>
        <div className="tl-detail-badges">
          <span><Router size={12} /> Technician</span>
          <span>{employee.username}</span>
        </div>
      </section>
      <section className="tl-detail-section" aria-labelledby="technician-learning-title">
        <h2 id="technician-learning-title"><ShieldCheck size={16} /> Your Technician workspace</h2>
        <p>Your access is limited to Technician learning material. Employee payroll and ISP administration remain separate.</p>
        <button type="button" className="tl-button tl-button-primary" onClick={() => setLocation(learningPath)}>
          <BookOpen size={15} /> Open Technician Learning Center <ArrowRight size={15} />
        </button>
      </section>
    </div>
  </main>;
}
