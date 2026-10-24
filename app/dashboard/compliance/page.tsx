// FILE PATH: ./app/dashboard/compliance/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getISTDateString } from "../../lib/aadhaarEngine";

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes("T")) return dateStr.split("T")[0];
  return dateStr;
};

export default function ComplianceDefaulterEngine() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [complianceData, setComplianceData] = useState<any[]>([]);
  const [filterMode, setFilterMode] = useState<"ALL" | "DEFAULTERS">(
    "DEFAULTERS"
  );
  const [isSending, setIsSending] = useState<string | null>(null);

  useEffect(() => {
    fetchComplianceMatrix();
  }, []);

  const fetchComplianceMatrix = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [
        partnersRes,
        salesRes,
        depositsRes,
        messagesRes,
        aadhaarRes,
        penaltiesRes,
      ] = await Promise.all([
        supabase
          .from("active_partners")
          .select(
            "id, partner_name, role, role_aadhaar, aadhaar_station_id, locations(center_code, center_name, dist)"
          )
          .eq("status", "Active"),
        supabase.from("daily_sales_reports").select("*"),
        supabase
          .from("partner_deposits")
          .select("*")
          .neq("status", "Discrepancy"),
        supabase
          .from("partner_messages")
          .select("partner_id")
          .eq("is_read", false),
        supabase
          .from("aadhaar_daily_reports")
          .select(
            "partner_id, report_date, total_cash_collected, deposit_status"
          ),
        supabase
          .from("aadhaar_penalty_logs")
          .select("partner_id, penalty_amount, is_settled, is_waived")
          .eq("is_settled", false),
      ]);

      if (partnersRes.error) throw partnersRes.error;

      const yesterdayStr = getISTDateString(-1);
      const safeSales = salesRes.data || [];
      const safeDeposits = depositsRes.data || [];
      const safeMessages = messagesRes.data || [];
      const safeAadhaar = aadhaarRes.data || [];
      // Exclude Admin-waived penalties so waived partners are never falsely flagged
      const safePenalties = (penaltiesRes.data || []).filter(
        (p: any) => !p.is_waived
      );

      const isAadhaarDeposit = (d: any) =>
        d.deposit_stream === "AADHAAR" ||
        String(d.reference_no || "")
          .toUpperCase()
          .startsWith("AADHAAR_");

      const matrix = (partnersRes.data || []).map((partner) => {
        const pSales = safeSales.filter((s) => s.partner_id === partner.id);
        const pAadhaar = safeAadhaar.filter((a) => a.partner_id === partner.id);
        const pPenalties = safePenalties.filter(
          (pen) => pen.partner_id === partner.id
        );
        const pTelecomDeposits = safeDeposits.filter(
          (d) => d.partner_id === partner.id && !isAadhaarDeposit(d)
        );
        const pAadhaarDeposits = safeDeposits.filter(
          (d) => d.partner_id === partner.id && isAadhaarDeposit(d)
        );
        const unreadCount = safeMessages.filter(
          (m) => m.partner_id === partner.id
        ).length;

        const submittedTelecomYest = pSales.some(
          (s) => normalizeToYYYYMMDD(s.report_date) === yesterdayStr
        );
        const submittedAadhaarYest = pAadhaar.some(
          (a) => normalizeToYYYYMMDD(a.report_date) === yesterdayStr
        );
        const submittedYesterday =
          submittedTelecomYest || submittedAadhaarYest;

        let telecomCash = 0;
        pSales.forEach((s) => {
          telecomCash +=
            Number(s.cbp_landline_amt || 0) +
            Number(s.cbp_gsm_amt || 0) +
            Number(s.ctop_recharge_amt || 0) +
            Number(s.sim_replacement_amt || 0) +
            Number(s.sim_fancy_amt || 0) +
            Number(s.sim_postpaid_amt || 0) +
            Number(s.other_amt || 0) +
            Number(s.frc_amt || 0) +
            Number(s.mnp_amt || 0) +
            Number(s.pb_cbp_amt || 0) +
            Number(s.pb_ctop_amt || 0) +
            Number(s.pb_frc_amt || 0) +
            Number(s.pb_mnp_amt || 0) +
            Number(s.pb_other_amt || 0);
        });

        const telecomDep = pTelecomDeposits.reduce(
          (sum, d) => sum + Number(d.deposit_amount || 0),
          0
        );

        // Unified Aadhaar Deduction Formula: Total Collection - Total Aadhaar Deposits
        const aadhaarTotalCash = pAadhaar.reduce(
          (sum, a) => sum + Number(a.total_cash_collected || 0),
          0
        );
        const aadhaarDep = pAadhaarDeposits.reduce(
          (sum, d) => sum + Number(d.deposit_amount || 0),
          0
        );
        const aadhaarPendingCash = Math.max(0, aadhaarTotalCash - aadhaarDep);

        const aadhaarPenaltyCash = pPenalties.reduce(
          (sum, pen) => sum + Number(pen.penalty_amount || 0),
          0
        );

        const pendingBalance =
          Math.max(0, telecomCash - telecomDep) +
          aadhaarPendingCash +
          aadhaarPenaltyCash;

        const isSalesDefaulter = !submittedYesterday;
        const isCashDefaulter = pendingBalance > 1000;
        const isCommDefaulter = unreadCount > 0;
        const isDefaulter =
          isSalesDefaulter || isCashDefaulter || isCommDefaulter;

        return {
          ...partner,
          submittedYesterday,
          pendingBalance,
          aadhaarPenaltyCash,
          unreadCount,
          isSalesDefaulter,
          isCashDefaulter,
          isCommDefaulter,
          isDefaulter,
        };
      });

      matrix.sort((a, b) => b.pendingBalance - a.pendingBalance);
      setComplianceData(matrix);
    } catch (err: any) {
      console.error("Compliance Matrix Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleIssueWarning = async (partner: any) => {
    if (
      !confirm(
        `Dispatch an automated official warning to ${partner.partner_name}?`
      )
    )
      return;

    setIsSending(partner.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Staff authentication failed.");

      let alertSubject = "Priority Compliance Notice";
      let alertBody = `Dear ${partner.partner_name},\n\nYou have been flagged by the Corporate Audit System for the following immediate actions:\n`;

      if (partner.isSalesDefaulter) {
        alertSubject = "Daily Sales / Aadhaar Report Unlogged";
        alertBody += `\n❌ MANDATORY ACTION: You failed to submit your Daily Sales or Aadhaar Status Report for yesterday. Log your report immediately.\n`;
      }
      if (partner.isCashDefaulter) {
        alertSubject = "Regular cash hold / Limit Exceeded";
        alertBody += `\n⚠️ TREASURY ALERT: Your pending cash balance (including any Aadhaar dues/penalties) is ₹${partner.pendingBalance.toLocaleString(
          "en-IN"
        )}, which exceeds the ₹1,000 threshold. Remit your dues immediately to avoid suspension.\n`;
      }
      if (partner.isCommDefaulter) {
        alertBody += `\n📬 COMMUNICATION HOLD: You have unread corporate alerts in your inbox. Please read and acknowledge them immediately.\n`;
      }

      const { error: msgError } = await supabase
        .from("partner_messages")
        .insert([
          {
            partner_id: partner.id,
            subject: `🚨 ALERT: ${alertSubject}`,
            body: alertBody,
          },
        ]);
      if (msgError) throw msgError;

      await supabase.from("staff_activity_logs").insert([
        {
          staff_id: user.id,
          staff_email: user.email,
          action_type: "DISPATCH_ALERT",
          module: "MESSAGES",
          target_id: partner.id,
          details: `Dispatched automated Defaulter Nudge to ${partner.partner_name} for compliance violations.`,
        },
      ]);

      alert(`✅ Warning dispatched successfully to ${partner.partner_name}.`);
      fetchComplianceMatrix();
    } catch (err: any) {
      alert("Error sending warning: " + err.message);
    } finally {
      setIsSending(null);
    }
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin"></div>
      </div>
    );

  const displayData =
    filterMode === "DEFAULTERS"
      ? complianceData.filter((p) => p.isDefaulter)
      : complianceData;

  const totalDefaulters = complianceData.filter((p) => p.isDefaulter).length;
  const cashDefaulters = complianceData.filter((p) => p.isCashDefaulter).length;
  const salesDefaulters = complianceData.filter(
    (p) => p.isSalesDefaulter
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-6 gap-4">
          <div>
            <Link
              href="/dashboard"
              className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-block"
            >
              &larr; Back to Admin Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">🚨</span> Defaulter &amp; Compliance
              Engine
            </h1>
            <p className="text-slate-500 font-medium mt-1">
              Automated oversight of unlogged Telecom/Aadhaar reports, high cash
              holdings, and unread notices.
            </p>
          </div>
          <button
            onClick={fetchComplianceMatrix}
            className="bg-white border-2 border-slate-200 text-slate-700 font-black px-4 py-2 rounded-lg hover:border-slate-400 transition flex items-center gap-2"
          >
            <span>🔄</span> Refresh Matrix
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-slate-800">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">
              Total Active Network
            </p>
            <p className="text-3xl font-black text-slate-800">
              {complianceData.length}{" "}
              <span className="text-sm font-bold text-slate-500">Partners</span>
            </p>
          </div>
          <div className="bg-red-50 p-6 rounded-xl border border-red-200 shadow-sm border-l-4 border-l-red-600">
            <p className="text-[10px] font-black uppercase text-red-600 tracking-widest mb-1">
              Total Defaulters
            </p>
            <p className="text-3xl font-black text-red-900">
              {totalDefaulters}{" "}
              <span className="text-sm font-bold text-red-700 opacity-80">
                Flagged
              </span>
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-amber-500">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">
              Missing Report (Yesterday)
            </p>
            <p className="text-3xl font-black text-slate-800">
              {salesDefaulters}{" "}
              <span className="text-sm font-bold text-slate-500">Centers</span>
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-pink-500">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">
              Cash Limit Breach (&gt;1K)
            </p>
            <p className="text-3xl font-black text-slate-800">
              {cashDefaulters}{" "}
              <span className="text-sm font-bold text-slate-500">Centers</span>
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
            <div>
              <h3 className="font-black tracking-widest uppercase text-xs">
                Live Compliance Roster
              </h3>
              <p className="text-[9px] text-slate-400 font-bold mt-1 tracking-widest">
                AUTOMATED SCAN: {new Date().toLocaleDateString("en-IN")}
              </p>
            </div>

            <div className="flex bg-slate-800 rounded-lg p-1">
              <button
                onClick={() => setFilterMode("DEFAULTERS")}
                className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition ${
                  filterMode === "DEFAULTERS"
                    ? "bg-red-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Defaulters Only ({totalDefaulters})
              </button>
              <button
                onClick={() => setFilterMode("ALL")}
                className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition ${
                  filterMode === "ALL"
                    ? "bg-blue-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                All Partners ({complianceData.length})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-4 font-black">Partner &amp; Location</th>
                  <th className="p-4 font-black text-center">
                    Yesterday&apos;s Report
                  </th>
                  <th className="p-4 font-black text-center">
                    Pending Cash Dues
                  </th>
                  <th className="p-4 font-black text-center">Unread Alerts</th>
                  <th className="p-4 font-black text-right">
                    Corporate Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-12 text-center text-slate-400 font-bold"
                    >
                      🎉 Perfect Compliance! No defaulters found.
                    </td>
                  </tr>
                ) : (
                  displayData.map((p) => (
                    <tr
                      key={p.id}
                      className={`transition ${
                        p.isDefaulter
                          ? "bg-red-50/30 hover:bg-red-50/60"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="p-4 align-middle">
                        <div className="flex items-center gap-2">
                          <p className="font-black text-slate-900">
                            {p.partner_name}
                          </p>
                          {(p.role_aadhaar ||
                            String(p.role || "")
                              .toUpperCase()
                              .includes("AADHAAR")) && (
                            <span className="text-[8px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded">
                              🆔 Stn: {p.aadhaar_station_id || "Aadhaar"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                            {p.locations?.center_code || "NO-CODE"}
                          </span>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                            {p.locations?.center_name} ({p.locations?.dist})
                          </p>
                        </div>
                      </td>

                      <td className="p-4 text-center align-middle">
                        {p.isSalesDefaulter ? (
                          <span className="bg-red-100 text-red-700 font-black text-[10px] px-2 py-1 rounded uppercase tracking-widest border border-red-200">
                            ❌ Missed
                          </span>
                        ) : (
                          <span className="bg-green-100 text-green-700 font-black text-[10px] px-2 py-1 rounded uppercase tracking-widest border border-green-200">
                            ✅ Submitted
                          </span>
                        )}
                      </td>

                      <td className="p-4 text-center align-middle">
                        {p.isCashDefaulter ? (
                          <div className="flex flex-col items-center">
                            <span className="text-red-600 font-black text-lg">
                              ₹
                              {Math.max(0, p.pendingBalance).toLocaleString(
                                "en-IN"
                              )}
                            </span>
                            <span className="text-[9px] font-black text-red-500 uppercase tracking-widest mt-0.5">
                              ⚠️ Limit Breach{" "}
                              {p.aadhaarPenaltyCash > 0
                                ? `(Incl. ₹${p.aadhaarPenaltyCash} Fine)`
                                : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-800 font-black">
                            ₹
                            {Math.max(0, p.pendingBalance).toLocaleString(
                              "en-IN"
                            )}
                          </span>
                        )}
                      </td>

                      <td className="p-4 text-center align-middle">
                        {p.isCommDefaulter ? (
                          <div className="flex flex-col items-center">
                            <span className="text-amber-600 font-black text-lg">
                              {p.unreadCount}
                            </span>
                            <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest mt-0.5">
                              ⏳ Ignored Notices
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-bold">0</span>
                        )}
                      </td>

                      <td className="p-4 text-right align-middle">
                        {p.isDefaulter ? (
                          <button
                            onClick={() => handleIssueWarning(p)}
                            disabled={isSending === p.id}
                            className="bg-red-600 hover:bg-red-700 text-white font-black px-4 py-2 rounded text-[10px] uppercase tracking-widest shadow-sm transition disabled:opacity-50 flex items-center gap-2 ml-auto"
                          >
                            {isSending === p.id
                              ? "Dispatching..."
                              : "🚨 Send Official Warning"}
                          </button>
                        ) : (
                          <span className="text-[10px] text-green-600 font-black uppercase tracking-widest">
                            ✅ Compliant
                          </span>
                        )}
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
  );
}