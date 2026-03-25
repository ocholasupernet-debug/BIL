import React, { useState } from "react";
import { Link } from "wouter";
import { Wifi, Phone, Lock, ArrowRight, Zap, CheckCircle2 } from "lucide-react";

export default function HotspotLogin() {
  const [activeTab, setActiveTab] = useState<'plans' | 'login' | 'voucher'>('plans');
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [stkSent, setStkSent] = useState(false);

  const MOCK_H_PLANS = [
    { name: "1 Hour", price: 20, time: "Unlimited", color: "from-pink-500 to-rose-600" },
    { name: "24 Hours", price: 50, time: "Unlimited", color: "from-purple-500 to-indigo-600" },
    { name: "7 Days", price: 250, time: "Unlimited", color: "from-cyan-500 to-blue-600" },
    { name: "30 Days", price: 800, time: "Unlimited", color: "from-emerald-500 to-teal-600" },
  ];

  const handlePay = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setStkSent(true);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#0d0415] text-white font-sans overflow-x-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-10%,#2d0d45_0%,#0d0415_55%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)] pointer-events-none" />

      {/* Header */}
      <header className="relative z-50 h-20 border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Wifi className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-extrabold tracking-tight text-lg leading-tight">OCHOLASUPERNET</h1>
              <p className="text-xs text-purple-300 font-medium">Hotspot Portal</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-400">Network Online</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 pt-12 pb-24">
        
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-black mb-4 tracking-tight">
            Connect to <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-fuchsia-400">Fast Internet</span>
          </h2>
          <p className="text-purple-200/70 max-w-lg mx-auto">Pay via M-Pesa and get connected instantly. No data caps, just reliable high-speed Wi-Fi.</p>
        </div>

        {/* Tab Toggle */}
        <div className="flex justify-center mb-10">
          <div className="bg-white/5 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 inline-flex">
            <button 
              onClick={() => setActiveTab('plans')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'plans' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'text-purple-200 hover:text-white'}`}
            >
              Buy Package
            </button>
            <button 
              onClick={() => setActiveTab('login')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'login' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'text-purple-200 hover:text-white'}`}
            >
              Member Login
            </button>
            <button 
              onClick={() => setActiveTab('voucher')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'voucher' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'text-purple-200 hover:text-white'}`}
            >
              Redeem Voucher
            </button>
          </div>
        </div>

        {/* Dynamic Content */}
        <div className="max-w-xl mx-auto">
          {activeTab === 'plans' && (
            <div className="space-y-8">
              {!stkSent ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {MOCK_H_PLANS.map((plan, i) => (
                      <button key={i} className="text-left bg-white/5 border border-white/10 rounded-2xl p-5 hover:-translate-y-1 transition-all hover:bg-white/10 hover:border-purple-500/50 group relative overflow-hidden">
                        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${plan.color} opacity-50 group-hover:opacity-100 transition-opacity`} />
                        <h3 className="font-bold text-lg mb-1">{plan.name}</h3>
                        <p className="text-3xl font-black mb-3">Ksh {plan.price}</p>
                        <p className="text-xs text-purple-300 font-medium flex items-center gap-1"><Zap className="w-3 h-3" /> {plan.time}</p>
                      </button>
                    ))}
                  </div>

                  <div className="bg-[#1a0f2e] border border-purple-500/30 rounded-3xl p-6 md:p-8 shadow-2xl">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <Phone className="text-emerald-400" /> Pay with M-Pesa
                    </h3>
                    <form onSubmit={handlePay} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-purple-300 uppercase mb-2">Phone Number</label>
                        <input 
                          type="tel" 
                          placeholder="07XX XXX XXX" 
                          required
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full bg-black/40 border border-purple-500/20 rounded-xl px-4 py-4 text-lg font-bold text-white focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                        />
                      </div>
                      <button 
                        type="submit" 
                        disabled={isLoading}
                        className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-lg shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all disabled:opacity-70 flex justify-center items-center gap-2"
                      >
                        {isLoading ? "Sending prompt..." : "Send STK Push"}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <div className="bg-[#1a0f2e] border border-emerald-500/30 rounded-3xl p-10 text-center shadow-2xl">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">STK Push Sent!</h3>
                  <p className="text-purple-200 mb-8">Check your phone and enter your M-Pesa PIN to complete the payment. You will be connected automatically.</p>
                  <button onClick={() => setStkSent(false)} className="text-sm font-bold text-emerald-400 hover:text-emerald-300">Start over</button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'login' && (
            <div className="bg-[#1a0f2e] border border-white/10 rounded-3xl p-6 md:p-10 shadow-2xl">
              <h3 className="text-2xl font-bold mb-6 text-center">Welcome Back</h3>
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-purple-300 uppercase mb-2">Username</label>
                  <input type="text" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:border-purple-500 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-purple-300 uppercase mb-2">Password</label>
                  <input type="password" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:border-purple-500 transition-all" />
                </div>
                <button className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white font-bold text-lg shadow-lg shadow-purple-500/25 mt-4">
                  Connect
                </button>
              </div>
            </div>
          )}

          {activeTab === 'voucher' && (
            <div className="bg-[#1a0f2e] border border-amber-500/20 rounded-3xl p-6 md:p-10 shadow-2xl">
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Ticket className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Redeem Voucher</h3>
                <p className="text-sm text-purple-200/70">Enter your printed code to get online.</p>
              </div>
              <div className="space-y-5">
                <input 
                  type="text" 
                  placeholder="XXXX-XXXX-XXXX" 
                  className="w-full bg-black/40 border border-amber-500/30 rounded-xl px-4 py-4 text-center font-mono text-xl tracking-widest text-amber-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all" 
                />
                <button className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold text-lg shadow-lg shadow-amber-500/25">
                  Activate Voucher
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
