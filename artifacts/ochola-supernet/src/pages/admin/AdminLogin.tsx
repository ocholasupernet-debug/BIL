import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Wifi, User, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrand } from "@/context/BrandContext";

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const brand = useBrand();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setLocation("/admin/dashboard");
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-[#080c10] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />
      <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] bg-cyan-500/20 rounded-full blur-[100px]" />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px]" />

      <div className="w-full max-w-md relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 border border-cyan-500/30 rounded-2xl animate-ping opacity-50" style={{ animationDuration: '2s' }} />
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.4)]">
              <Wifi className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">{brand.ispName}</h1>
          <p className="text-slate-400 text-sm mt-1">ISP Admin Portal · {brand.domain}</p>
        </div>

        <div className="bg-[#111820]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500" />
          
          <form onSubmit={handleLogin} className="p-8 space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Username</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="admin"
                  defaultValue="admin"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  defaultValue="password"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-12 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button 
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all flex items-center justify-center gap-2 group disabled:opacity-70"
            >
              {isLoading ? "Authenticating..." : "Sign In"}
              {!isLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
            </button>

            <div className="flex items-center gap-4 my-6 opacity-60">
              <div className="flex-1 h-px bg-white/20" />
              <span className="text-xs font-medium text-slate-400 uppercase">or</span>
              <div className="flex-1 h-px bg-white/20" />
            </div>

            <button 
              type="button"
              onClick={() => setLocation("/admin/dashboard")}
              className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-semibold hover:bg-white/10 transition-all"
            >
              Continue as Demo Admin
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don't have an account?{" "}
          <Link href="/admin/register">
            <span className="text-cyan-400 font-semibold hover:text-cyan-300 cursor-pointer transition-colors">Register your ISP</span>
          </Link>
        </p>

        <div className="mt-4 flex justify-center items-center gap-2">
          <div className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </div>
          <span className="text-xs font-medium text-slate-500">All systems operational · {brand.domain}</span>
        </div>
      </div>
    </div>
  );
}
