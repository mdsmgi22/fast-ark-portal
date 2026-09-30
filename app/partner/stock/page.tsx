"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function PartnerStockRequest() {
  const router = useRouter();
  const [partner, setPartner] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Auto-detect OCSC Rules
  const [isOCSC, setIsOCSC] = useState(false);

  const [form, setForm] = useState({
    stock_type: "CBP",
    ctop_no: "",
    qty: "",
    amount: "",
    commission_percent: "3.5",
  });

  useEffect(() => {
    fetchPartnerAndRequests();
  }, []);

  const fetchPartnerAndRequests = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/partner/login");
        return;
      }

      // Secure fetch using ilike and maybeSingle
      const { data: partnerData, error: partnerError } = await supabase
        .from("active_partners")
        .select("id, partner_name, role, center_id, locations(center_name)")
        .ilike("email", session.user.email || "")
        .maybeSingle();

      if (partnerError) throw partnerError;
      if (!partnerData) throw new Error("Database Desync: Your partner profile could not be loaded.");
      
      setPartner(partnerData);

      // OCSC Strict Override Check
      if (partnerData.role?.toUpperCase().includes('OCSC')) {
        setIsOCSC(true);
      }

      const { data: reqData, error: reqError } = await supabase
        .from("stock_requests")
        .select("*")
        .eq("partner_id", partnerData.id)
        .order("created_at", { ascending: false });

      if (reqError) throw reqError;
      setRequests(reqData || []);
    } catch (err: any) {
      console.error("Error loading stock data:", err.message);
      if (err.message.includes("Desync")) {
        alert(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const qtyNum = parseInt(form.qty, 10);
    
    // OCSC Strict Overrides force Amount to 0. 
    const amountNum = (!isOCSC && form.amount) ? parseFloat(form.amount) : 0;
    
    // [CRITICAL FIX]: Reverted Commission to `null` to safely bypass the CHECK constraint
    const commNum = (!isOCSC && form.stock_type === "CTOP" && form.commission_percent) ? parseFloat(form.commission_percent) : null;

    if (qtyNum <= 0 || isNaN(qtyNum)) {
      alert("Quantity must be greater than zero.");
      setSubmitting(false);
      return;
    }

    if (amountNum < 0 || isNaN(amountNum)) {
      alert("Amount cannot be negative.");
      setSubmitting(false);
      return;
    }

    if (form.stock_type === "CTOP") {
      if (form.ctop_no.length !== 10) {
        alert("CTOP Number must be exactly 10 digits.");
        setSubmitting(false);
        return;
      }
      // Commission validation is completely bypassed for OCSC
      if (!isOCSC && (commNum === null || commNum < 2.0 || commNum > 5.6)) {
        alert("CTOP Commission percentage must be strictly between 2.0% and 5.6%.");
        setSubmitting(false);
        return;
      }
    }

    try {
      const { error } = await supabase.from("stock_requests").insert([
        {
          partner_id: partner.id,
          center_id: partner.center_id,
          stock_type: form.stock_type,
          
          // [CRITICAL FIX]: Keep empty string "" to satisfy the NOT NULL constraint
          ctop_no: form.stock_type === "CTOP" ? form.ctop_no : "", 
          
          qty: qtyNum,
          amount: amountNum,
          
          // Will safely insert `null` for OCSC/SIM/CBP, bypassing the 2.0-5.6 Check Constraint
          commission_percent: commNum, 
          
          status: "Pending",
        },
      ]);

      if (error) throw error;

      alert("✅ Stock request submitted successfully.");
      setForm({ stock_type: "CBP", ctop_no: "", qty: "", amount: "", commission_percent: "3.5" });
      fetchPartnerAndRequests();
    } catch (err: any) {
      alert("Error placing request: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <div className="flex justify-between items-center border-b pb-4">
          <div>
            <Link href="/partner/dashboard" className="text-blue-600 text-sm font-bold hover:underline">
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900 mt-1">Stock Indent & Inventory Request</h1>
            <p className="text-slate-500 text-sm font-medium">
              Center: {partner?.locations?.center_name || "Assigned Center"} | Role: <span className="uppercase font-black text-blue-600">{partner?.role}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Side: Request Form */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-fit sticky top-8">
            <h2 className="text-lg font-black text-slate-800 mb-4 pb-2 border-b">Raise New Stock Request</h2>
            
            {/* OCSC Warning Banner */}
            {isOCSC && (
              <div className="bg-blue-50 p-3 mb-4 rounded border border-blue-200 text-blue-800 text-[10px] font-black uppercase tracking-widest text-center shadow-sm">
                OCSC Override: Pure Quantity Requests Only
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-sm font-medium">
              
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">Stock Type</label>
                <select
                  value={form.stock_type}
                  onChange={(e) => setForm({ ...form, stock_type: e.target.value })}
                  className="w-full border border-slate-300 p-2.5 rounded-lg bg-slate-50 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="CBP">CBP</option>
                  <option value="CTOP">CTOP (Recharge Balance)</option>
                  <option value="SIM">SIM Inventory</option>
                </select>
              </div>

              {form.stock_type === "CTOP" && (
                <div>
                  <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">CTOP Number</label>
                  <input
                    required
                    type="text"
                    maxLength={10}
                    placeholder="10-digit CTOP"
                    value={form.ctop_no}
                    onChange={(e) => setForm({ ...form, ctop_no: e.target.value.replace(/\D/g, "") })}
                    className="w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                  />
                </div>
              )}

              <div className={`grid ${isOCSC ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                <div>
                  <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">Quantity</label>
                  <input
                    required
                    type="number"
                    step="1"
                    min="1"
                    placeholder="0"
                    value={form.qty}
                    onChange={(e) => setForm({ ...form, qty: e.target.value })}
                    className={numInputClass}
                  />
                </div>

                {/* Amount field dynamically hidden for OCSC */}
                {!isOCSC && (
                  <div>
                    <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">Total Amount (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      className={numInputClass}
                    />
                  </div>
                )}
              </div>

              {/* Commission field dynamically hidden for OCSC */}
              {form.stock_type === "CTOP" && !isOCSC && (
                <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                  <label className="block text-amber-900 font-bold mb-1 uppercase text-[10px] tracking-widest">Commission % (2.0 - 5.6%)</label>
                  <input
                    required
                    type="number"
                    step="0.1"
                    min="2.0"
                    max="5.6"
                    value={form.commission_percent}
                    onChange={(e) => setForm({ ...form, commission_percent: e.target.value })}
                    className="w-full border border-amber-300 p-2.5 rounded text-amber-900 font-black outline-none focus:ring-2 focus:ring-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl transition shadow-md disabled:bg-slate-400 mt-4"
              >
                {submitting ? "Submitting..." : "Send Stock Request"}
              </button>
            </form>
          </div>

          {/* Right Side: Requisition History Table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
              <h2 className="font-black text-slate-800">Stock Requisition History</h2>
              <button
                onClick={fetchPartnerAndRequests}
                className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-md font-bold hover:bg-slate-100 transition shadow-sm"
              >
                ↻ Refresh
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-[10px] uppercase tracking-widest border-b">
                    <th className="p-4 font-bold">Date</th>
                    <th className="p-4 font-bold">Details</th>
                    <th className="p-4 font-bold">Qty</th>
                    <th className="p-4 font-bold">Amount</th>
                    <th className="p-4 font-bold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 font-medium">
                        No previous stock requests found.
                      </td>
                    </tr>
                  ) : (
                    requests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50 transition">
                        <td className="p-4 text-slate-500 font-medium whitespace-nowrap">
                          {new Date(req.created_at).toLocaleDateString()}
                        </td>
                        <td className="p-4">
                          <p className="font-black text-blue-700">{req.stock_type}</p>
                          {req.stock_type === "CTOP" && (
                            <p className="text-xs text-slate-500 font-bold mt-0.5">
                              No: {req.ctop_no} {req.commission_percent ? <span className="text-amber-600 ml-1">({req.commission_percent}%)</span> : null}
                            </p>
                          )}
                        </td>
                        <td className="p-4 font-black text-slate-800 text-lg">{req.qty}</td>
                        <td className="p-4 font-bold text-slate-600">
                          {req.amount > 0 ? `₹${Number(req.amount).toLocaleString('en-IN')}` : <span className="text-slate-500 uppercase text-[9px] bg-slate-200 px-2 py-1 rounded border border-slate-300 font-black tracking-widest">Pure Qty</span>}
                        </td>
                        <td className="p-4 text-right">
                          <span
                            className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest ${
                              req.status === "Approved"
                                ? "bg-green-100 text-green-800"
                                : req.status === "Dispatched"
                                ? "bg-blue-100 text-blue-800"
                                : req.status === "Rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {req.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}