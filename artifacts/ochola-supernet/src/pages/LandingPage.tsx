import React from "react";
import { Link } from "wouter";
import { Shield, Zap, CreditCard, Activity, Wifi, Ticket, ArrowRight, CheckCircle2, Users, Server } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#080c10] text-slate-200 font-sans selection:bg-cyan-500/30">
      <div className="fixed inset-0 bg-grid-pattern opacity-40 pointer-events-none" />
      
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-[#080c10]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)] group-hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-shadow">
              <Wifi className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold text-white leading-none">OcholaSupernet</p>
              <p className="text-[10px] text-cyan-400 font-bold tracking-widest uppercase">Platform</p>
            </div>
          </Link>
          
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Pricing</a>
            <a href="#contact" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Contact</a>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/admin/login" className="text-sm font-semibold text-slate-300 hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/isp-register" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white text-sm font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:-translate-y-0.5 transition-all">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-40 pb-20 px-6 relative">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-cyan-500/20 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold tracking-wide uppercase mb-8">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            ISP & Hotspot Management
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tight mb-6 leading-[1.1]">
            Manage Your Network.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400">
              Grow Your Business.
            </span>
          </h1>
          
          <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            OcholaSupernet gives ISPs and hotspot operators a complete platform — billing, MikroTik automation, PPPoE, RADIUS, and M-Pesa payments in one place.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/isp-register" className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white font-bold text-lg shadow-xl shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:-translate-y-1 transition-all flex items-center justify-center gap-2">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
            <Link href="/admin/login" className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-lg hover:bg-white/10 transition-all text-center">
              View Live Demo
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y border-white/10 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <p className="text-4xl font-black text-cyan-400 mb-2">500+</p>
            <p className="text-sm text-slate-400 font-medium uppercase tracking-wide">ISPs Managed</p>
          </div>
          <div>
            <p className="text-4xl font-black text-emerald-400 mb-2">120k+</p>
            <p className="text-sm text-slate-400 font-medium uppercase tracking-wide">Active Customers</p>
          </div>
          <div>
            <p className="text-4xl font-black text-indigo-400 mb-2">99.9%</p>
            <p className="text-sm text-slate-400 font-medium uppercase tracking-wide">Uptime SLA</p>
          </div>
          <div>
            <p className="text-4xl font-black text-amber-400 mb-2">Instant</p>
            <p className="text-sm text-slate-400 font-medium uppercase tracking-wide">M-Pesa Activation</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-cyan-400 font-bold text-sm tracking-widest uppercase mb-3">Platform Features</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Everything your ISP needs</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">We handle the complex backend integrations so you can focus on expanding your fiber and wireless coverage.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            { title: "Customer Management", icon: Users, color: "text-cyan-400", bg: "bg-cyan-400/10", desc: "Full CRUD for PPPoE and hotspot customers. Manage expiry, renewal, and suspension." },
            { title: "M-Pesa Automation", icon: CreditCard, color: "text-emerald-400", bg: "bg-emerald-400/10", desc: "Integrated Safaricom Daraja API for automatic payments and STK push." },
            { title: "MikroTik Sync", icon: Activity, color: "text-indigo-400", bg: "bg-indigo-400/10", desc: "Remotely configure routers, manage PPPoE secrets, IP pools, and queues." },
            { title: "Hotspot Vouchers", icon: Ticket, color: "text-amber-400", bg: "bg-amber-400/10", desc: "Generate, print, and sell vouchers for hotspot plans seamlessly." },
            { title: "FreeRADIUS", icon: Server, color: "text-rose-400", bg: "bg-rose-400/10", desc: "Full RADIUS authentication and accounting for real-time session monitoring." },
            { title: "Secure & White-label", icon: Shield, color: "text-blue-400", bg: "bg-blue-400/10", desc: "Your own domain, your brand logo, running on enterprise-grade infrastructure." }
          ].map((feat, i) => (
            <div key={i} className="bg-[#111820] border border-white/10 p-8 rounded-2xl hover:-translate-y-2 transition-transform duration-300 hover:border-white/20">
              <div className={`w-14 h-14 rounded-xl ${feat.bg} flex items-center justify-center mb-6`}>
                <feat.icon className={`w-7 h-7 ${feat.color}`} />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{feat.title}</h3>
              <p className="text-slate-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Simple, transparent pricing</h2>
            <p className="text-slate-400">Scale your network without hidden fees.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="bg-[#111820] border border-white/10 rounded-3xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Starter</h3>
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-4xl font-black text-white">Ksh 2,500</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <ul className="space-y-4 mb-8">
                {["Up to 100 customers", "M-Pesa Automation", "1 Router", "Basic Support"].map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="w-5 h-5 text-cyan-400" /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/isp-register" className="block w-full py-3 rounded-xl bg-white/5 border border-white/10 text-center font-bold text-white hover:bg-white/10 transition-colors">Choose Starter</Link>
            </div>

            <div className="bg-gradient-to-b from-cyan-900/40 to-[#111820] border border-cyan-500/30 rounded-3xl p-8 relative transform md:-translate-y-4 shadow-2xl shadow-cyan-900/20">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-t-3xl" />
              <div className="absolute top-4 right-4 bg-cyan-500/20 text-cyan-400 text-xs font-bold px-3 py-1 rounded-full border border-cyan-500/30">POPULAR</div>
              <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-4xl font-black text-white">Ksh 5,500</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <ul className="space-y-4 mb-8">
                {["Unlimited customers", "M-Pesa Automation", "Unlimited Routers", "FreeRADIUS Support", "Priority Support"].map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="w-5 h-5 text-cyan-400" /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/isp-register" className="block w-full py-3 rounded-xl bg-cyan-500 text-center font-bold text-white hover:bg-cyan-400 shadow-lg shadow-cyan-500/25 transition-colors">Start Free Trial</Link>
            </div>

            <div className="bg-[#111820] border border-white/10 rounded-3xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Enterprise</h3>
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-4xl font-black text-white">Custom</span>
              </div>
              <ul className="space-y-4 mb-8">
                {["Dedicated Server", "Custom Integrations", "SLA Guarantee", "24/7 Phone Support"].map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="w-5 h-5 text-cyan-400" /> {f}
                  </li>
                ))}
              </ul>
              <a href="#contact" className="block w-full py-3 rounded-xl bg-white/5 border border-white/10 text-center font-bold text-white hover:bg-white/10 transition-colors">Contact Sales</a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Wifi className="w-6 h-6 text-cyan-500" />
            <span className="font-bold text-white">OcholaSupernet</span>
          </div>
          <p className="text-slate-500 text-sm">© 2026 isplatty.org. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/admin/login" className="text-slate-500 hover:text-white text-sm transition-colors">Admin Portal</Link>
            <Link href="/super-admin/dashboard" className="text-slate-500 hover:text-indigo-400 text-sm transition-colors">Super Admin</Link>
            <Link href="/hotspot-login" className="text-slate-500 hover:text-purple-400 text-sm transition-colors">Hotspot Demo</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
