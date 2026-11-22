import { ArrowUpRight, ShieldCheck } from "lucide-react";

export default function StaffPortalStatusPage() {
  const isSecureConnection = typeof window !== "undefined" && window.location.protocol === "https:";

  return (
    <main className="min-h-screen bg-[#f3f6fb] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-7 sm:px-8">
        <header className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-700 text-white shadow-lg shadow-blue-900/15">
            <ShieldCheck aria-hidden="true" size={22} />
          </div>
          <div>
            <p className="text-sm font-extrabold tracking-[0.16em] text-slate-900">ISPLATTY</p>
            <p className="text-xs font-medium text-slate-500">Staff portal</p>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-blue-800 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Staff access
            </span>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">
              Staff sign-in is temporarily unavailable.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
              This portal is being brought online after its account and security checks are complete.
              Please return later or contact your administrator for assistance.
            </p>
            <div
              className="mt-8 flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              role="status"
              aria-live="polite"
            >
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <ShieldCheck aria-hidden="true" size={19} />
              </div>
              <p className="text-sm leading-6 text-slate-600">
                Do not enter or send your password on this page. It does not collect or store sign-in details.
              </p>
            </div>
            <a
              className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-md shadow-blue-900/15 transition hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              href="https://isplatty.com"
            >
              Visit ISPLATTY
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
          </div>

          <aside className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-blue-200/70 via-cyan-100/60 to-white blur-2xl" />
            <div className="relative rounded-[1.75rem] border border-white bg-white/90 p-6 shadow-xl shadow-slate-900/10 backdrop-blur">
              <div className="flex items-center justify-between border-b border-slate-100 pb-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Portal status</p>
                  <p className="mt-1 text-xl font-extrabold text-slate-900">Setup in progress</p>
                </div>
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                  <ShieldCheck aria-hidden="true" size={24} />
                </div>
              </div>
              <ol className="mt-5 space-y-4">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">1</span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">Website connection</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {isSecureConnection
                        ? "Your connection is encrypted."
                        : "Use the HTTPS address for an encrypted connection."}
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">2</span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">Account access</p>
                    <p className="mt-1 text-sm text-slate-500">Sign-in will open after administrator verification.</p>
                  </div>
                </li>
              </ol>
              <div className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                Shared Staff portal · staff.isplatty.com
              </div>
            </div>
          </aside>
        </section>

        <footer className="border-t border-slate-200 py-5 text-xs text-slate-500">
          © {new Date().getFullYear()} ISPLATTY. Secure access for authorized staff.
        </footer>
      </div>
    </main>
  );
}
