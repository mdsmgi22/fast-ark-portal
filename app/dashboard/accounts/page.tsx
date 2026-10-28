// FILE PATH: ./app/dashboard/accounts/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
} from "../../lib/aadhaarEngine";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val ?? "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

const DISCREPANCY_REASONS = [
  "UTR not credited in bank statement",
  "Deposit amount mismatch with uploaded slip",
  "Blurred / unreadable receipt image",
  "Duplicate UTR / receipt already used",
  "Paid to wrong bank / unmapped UPI ID",
  "Missing slip exemption not approved",
  "Other (Specify Below)",
];

export default function DepositVerificationPortal() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [staffUser, setStaffUser] = useState<any>(null);

  // Master Data Streams
  const [deposits, setDeposits] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [virtualAccounts, setVirtualAccounts] = useState<any[]>([]);
  const [upiIds, setUpiIds] = useState<any[]>([]);

  // 4-Tier Cascade + Stream + Status + 7-Preset Date Filters
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [toDate, setToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );
  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fPartner, setFPartner] = useState("ALL");
  const [fStream, setFStream] = useState<"ALL" | "TELECOM" | "AADHAAR">("ALL");
  const [fStatus, setFStatus] = useState<
    "ALL" | "Pending" | "Verified" | "Discrepancy"
  >("Pending");
  const [searchQuery, setSearchQuery] = useState("");

  // Side-by-Side Receipt Inspector State
  const [selectedDeposit, setSelectedDeposit] = useState<any | null>(null);
  const [signedSlipUrl, setSignedSlipUrl] = useState<string | null>(null);
  const [loadingSlip, setLoadingSlip] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Inline Edit Mode (Fix Partner UTR / Amount / Method Typos Before Approving)
  const [isEditingDeposit, setIsEditingDeposit] = useState(false);
  const [editDepForm, setEditDepForm] = useState({
    deposit_amount: "",
    deposit_method: "UPI",
    utr_number: "",
    transaction_id: "",
    deposit_date: "",
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Structured Discrepancy Drawer State
  const [showDiscrepancyBox, setShowDiscrepancyBox] = useState(false);
  const [discrepancyPreset, setDiscrepancyPreset] = useState("");
  const [discrepancyCustomText, setDiscrepancyCustomText] = useState("");

  useEffect(() => {
    initializeAccountsPortal();
  }, [fromDate, toDate]);

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  const initializeAccountsPortal = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data: staff } = await supabase
        .from("back_office_staff")
        .select("*")
        .ilike("email", (session.user.email || "").trim())
        .maybeSingle();

      if (!staff || staff.status !== "Active") {
        return router.push("/login");
      }
      setStaffUser(staff);

      const [locRes, partRes, depRes, vaRes, upiRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"),
        supabase
          .from("active_partners")
          .select(
            "id, partner_name, email, mobile, role, center_id, aadhaar_station_id, locations(id, center_name, center_code, state, dist, parent_master_id)"
          )
          .order("partner_name"),
        supabase
          .from("partner_deposits")
          .select(
            "*, active_partners(id, partner_name, email, mobile, role, center_id, aadhaar_station_id, locations(id, center_name, center_code, state, dist, parent_master_id))"
          )
          .gte("deposit_date", fromDate)
          .lte("deposit_date", toDate)
          .order("deposit_date", { ascending: false }),
        supabase
          .from("virtual_accounts")
          .select("*, master_banks(bank_name, actual_account_no, ifsc_code)")
          .eq("is_active", true),
        supabase
          .from("upi_ids")
          .select("*, master_banks(bank_name, actual_account_no)")
          .eq("is_active", true),
      ]);

      setLocations(locRes.data || []);
      setPartners(partRes.data || []);
      setDeposits(depRes.data || []);
      setVirtualAccounts(vaRes.data || []);
      setUpiIds(upiRes.data || []);
    } catch (err: any) {
      console.error("Deposit Verification Init Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const isAadhaarDeposit = (d: any) =>
    d.deposit_stream === "AADHAAR" ||
    String(d.reference_no || "")
      .toUpperCase()
      .startsWith("AADHAAR_");

  const getCleanUtr = (d: any) =>
    String(
      d.utr_number || String(d.reference_no || "").replace(/^AADHAAR_/i, "")
    )
      .trim()
      .toUpperCase();

  // Duplicate UTR Map across loaded window
  const utrFrequencyMap = useMemo(() => {
    const map: Record<string, number> = {};
    deposits.forEach((d) => {
      const u = getCleanUtr(d);
      if (u && u !== "N/A") {
        map[u] = (map[u] || 0) + 1;
      }
    });
    return map;
  }, [deposits]);

  // 4-Tier Cascade Options
  const uniqueStates = useMemo(
    () =>
      Array.from(
        new Set(locations.map((l) => l.state).filter(Boolean))
      ).sort(),
    [locations]
  );

  const hqOptions = useMemo(
    () =>
      locations.filter(
        (l) => l.is_master_node && (fState === "ALL" || l.state === fState)
      ),
    [locations, fState]
  );

  const centerOptions = useMemo(
    () =>
      locations.filter(
        (l) =>
          !l.is_master_node &&
          (fState === "ALL" || l.state === fState) &&
          (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
      ),
    [locations, fState, fHq]
  );

  const partnerOptions = useMemo(() => {
    return partners.filter((p) => {
      const locData = p.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      if (!loc) return false;
      if (fState !== "ALL" && loc.state !== fState) return false;
      if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq)
        return false;
      if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return false;
      return true;
    });
  }, [partners, fState, fHq, fCenter]);

  const filteredDeposits = useMemo(() => {
    return deposits.filter((d) => {
      const locData = d.active_partners?.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      if (!loc) return false;

      if (fState !== "ALL" && loc.state !== fState) return false;
      if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq)
        return false;
      if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return false;
      if (fPartner !== "ALL" && d.partner_id !== fPartner) return false;

      const isAdh = isAadhaarDeposit(d);
      if (fStream === "AADHAAR" && !isAdh) return false;
      if (fStream === "TELECOM" && isAdh) return false;

      if (fStatus !== "ALL") {
        if (
          fStatus === "Pending" &&
          !String(d.status || "").includes("Pending")
        )
          return false;
        if (fStatus !== "Pending" && d.status !== fStatus) return false;
      }

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        d.active_partners?.partner_name?.toLowerCase().includes(q) ||
        loc.center_code?.toLowerCase().includes(q) ||
        loc.center_name?.toLowerCase().includes(q) ||
        getCleanUtr(d).toLowerCase().includes(q) ||
        String(d.transaction_id || "")
          .toLowerCase()
          .includes(q) ||
        String(d.reference_code || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [
    deposits,
    fState,
    fHq,
    fCenter,
    fPartner,
    fStream,
    fStatus,
    searchQuery,
  ]);

  const handleInspectDeposit = async (dep: any) => {
    setSelectedDeposit(dep);
    setSignedSlipUrl(null);
    setIsEditingDeposit(false);
    setShowDiscrepancyBox(false);
    setDiscrepancyPreset("");
    setDiscrepancyCustomText("");

    const cleanUtr = getCleanUtr(dep);
    setEditDepForm({
      deposit_amount: String(dep.deposit_amount || ""),
      deposit_method: dep.deposit_method || "UPI",
      utr_number: cleanUtr,
      transaction_id: dep.transaction_id || cleanUtr,
      deposit_date: String(dep.deposit_date || dep.created_at || "").split(
        "T"
      )[0],
    });

    if (!dep.deposit_slip_url) return;

    setLoadingSlip(true);
    try {
      if (String(dep.deposit_slip_url).startsWith("http")) {
        setSignedSlipUrl(dep.deposit_slip_url);
        return;
      }
      const { data, error } = await supabase.storage
        .from("deposit-slips")
        .createSignedUrl(dep.deposit_slip_url, 1800);
      if (error) throw error;
      setSignedSlipUrl(data?.signedUrl || null);
    } catch (err: any) {
      console.error("Slip load error:", err.message);
    } finally {
      setLoadingSlip(false);
    }
  };

  // --- INLINE EDIT AMOUNT / UTR / METHOD BY ACCOUNTANT / ADMIN ---
  const handleSaveDepositEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeposit) return;

    const amt = parseFloat(editDepForm.deposit_amount);
    const cleanUtr = editDepForm.utr_number
      .trim()
      .replace(/^AADHAAR_/i, "")
      .replace(/\s+/g, "")
      .toUpperCase();
    const cleanTxn = (editDepForm.transaction_id || cleanUtr)
      .trim()
      .toUpperCase();

    if (isNaN(amt) || amt <= 0)
      return alert("Deposit Amount must be greater than zero.");
    if (cleanUtr.length < 4)
      return alert("Unique UTR Number must be at least 4 characters.");

    setIsSavingEdit(true);
    try {
      const isAdh = isAadhaarDeposit(selectedDeposit);
      const formattedRefNo = isAdh ? `AADHAAR_${cleanUtr}` : cleanUtr;

      const { error: richErr } = await supabase
        .from("partner_deposits")
        .update({
          deposit_amount: amt,
          deposit_method: editDepForm.deposit_method,
          deposit_date: editDepForm.deposit_date,
          reference_no: formattedRefNo,
          utr_number: cleanUtr,
          transaction_id: cleanTxn,
        })
        .eq("id", selectedDeposit.id);

      if (richErr && richErr.code === "42703") {
        const { error: fbErr } = await supabase
          .from("partner_deposits")
          .update({
            deposit_amount: amt,
            deposit_method: editDepForm.deposit_method,
            deposit_date: editDepForm.deposit_date,
            reference_no: formattedRefNo,
          })
          .eq("id", selectedDeposit.id);
        if (fbErr) throw fbErr;
      } else if (richErr) {
        throw richErr;
      }

      if (staffUser) {
        await supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser.id,
            staff_email: staffUser.email,
            action_type: "DEPOSIT_EDIT",
            module: "ACCOUNTS",
            target_id: selectedDeposit.id,
            details: `Updated deposit record (Amount: ₹${amt}, UTR: ${cleanUtr}, Method: ${editDepForm.deposit_method}) for ${selectedDeposit.active_partners?.partner_name}.`,
          },
        ]);
      }

      const updatedObj = {
        ...selectedDeposit,
        deposit_amount: amt,
        deposit_method: editDepForm.deposit_method,
        deposit_date: editDepForm.deposit_date,
        reference_no: formattedRefNo,
        utr_number: cleanUtr,
        transaction_id: cleanTxn,
      };
      setSelectedDeposit(updatedObj);
      setIsEditingDeposit(false);
      await initializeAccountsPortal();
    } catch (err: any) {
      alert("Error updating deposit details: " + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // --- AUDIT DECISION: VERIFY, FLAG DISCREPANCY, OR RESET TO PENDING ---
  const handleAuditAction = async (
    dep: any,
    newStatus: "Verified" | "Discrepancy" | "Pending"
  ) => {
    let rejectionReason = "";
    if (newStatus === "Discrepancy") {
      if (!discrepancyPreset) {
        setShowDiscrepancyBox(true);
        return;
      }
      if (
        discrepancyPreset === "Other (Specify Below)" &&
        discrepancyCustomText.trim().length < 4
      ) {
        return alert("Please enter a clear custom discrepancy reason.");
      }
      rejectionReason =
        discrepancyPreset === "Other (Specify Below)"
          ? discrepancyCustomText.trim()
          : discrepancyPreset;
    } else if (newStatus === "Verified") {
      if (
        !confirm(
          `Verify ₹${Number(dep.deposit_amount).toLocaleString(
            "en-IN"
          )} remittance (UTR: ${getCleanUtr(dep)}) for ${
            dep.active_partners?.partner_name
          }?`
        )
      )
        return;
    } else if (newStatus === "Pending") {
      if (
        !confirm(
          `Reset this deposit (₹${Number(dep.deposit_amount).toLocaleString(
            "en-IN"
          )}) back to Pending status?`
        )
      )
        return;
    }

    setProcessingId(dep.id);
    try {
      const { error } = await supabase
        .from("partner_deposits")
        .update({
          status: newStatus,
          rejection_reason: newStatus === "Discrepancy" ? rejectionReason : null,
        })
        .eq("id", dep.id);

      if (error) throw error;

      // Sync Aadhaar Daily Reports & Penalty Logs if this is an Aadhaar deposit
      if (isAadhaarDeposit(dep)) {
        if (newStatus === "Verified") {
          await supabase
            .from("aadhaar_daily_reports")
            .update({ deposit_status: "Settled" })
            .eq("deposit_id", dep.id);
        } else if (newStatus === "Discrepancy") {
          await supabase
            .from("aadhaar_daily_reports")
            .update({ deposit_status: "Pending Deposit", deposit_id: null })
            .eq("deposit_id", dep.id);

          await supabase
            .from("aadhaar_penalty_logs")
            .update({ is_settled: false, settled_by_deposit_id: null })
            .eq("settled_by_deposit_id", dep.id);
        } else if (newStatus === "Pending") {
          await supabase
            .from("aadhaar_daily_reports")
            .update({ deposit_status: "Deposit Submitted" })
            .eq("deposit_id", dep.id);
        }
      }

      const cleanUtr = getCleanUtr(dep);
      if (newStatus !== "Pending") {
        await supabase.from("partner_messages").insert([
          {
            partner_id: dep.partner_id,
            subject:
              newStatus === "Verified"
                ? `✅ Deposit Verified: ₹${Number(
                    dep.deposit_amount
                  ).toLocaleString("en-IN")}`
                : `🚨 Deposit Discrepancy Flagged: ₹${Number(
                    dep.deposit_amount
                  ).toLocaleString("en-IN")}`,
            body:
              newStatus === "Verified"
                ? `Your remittance of ₹${Number(
                    dep.deposit_amount
                  ).toLocaleString(
                    "en-IN"
                  )} (UTR: ${cleanUtr}) has been verified and credited to your ledger.`
                : `Your remittance of ₹${Number(
                    dep.deposit_amount
                  ).toLocaleString(
                    "en-IN"
                  )} (UTR: ${cleanUtr}) was marked as Discrepancy. Reason: ${rejectionReason}. Please re-verify and submit a valid receipt.`,
          },
        ]);
      }

      if (staffUser) {
        await supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser.id,
            staff_email: staffUser.email,
            action_type:
              newStatus === "Verified"
                ? "DEPOSIT_VERIFIED"
                : newStatus === "Discrepancy"
                ? "DEPOSIT_DISCREPANCY"
                : "DEPOSIT_RESET_PENDING",
            module: "ACCOUNTS",
            target_id: dep.id,
            details: `Marked deposit of ₹${dep.deposit_amount} (UTR: ${cleanUtr}) as ${newStatus} for ${dep.active_partners?.partner_name}.${
              rejectionReason ? ` Reason: ${rejectionReason}` : ""
            }`,
          },
        ]);
      }

      setShowDiscrepancyBox(false);
      setDiscrepancyPreset("");
      setDiscrepancyCustomText("");
      if (selectedDeposit?.id === dep.id) {
        setSelectedDeposit({
          ...selectedDeposit,
          status: newStatus,
          rejection_reason: rejectionReason || null,
        });
      }
      await initializeAccountsPortal();
    } catch (err: any) {
      alert("Verification Error: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleExportCSV = () => {
    if (filteredDeposits.length === 0)
      return alert("No deposit records match the current filters.");

    const headers = [
      "Deposit Date (DD/MM/YYYY)",
      "Reference Code",
      "Vertical Stream",
      "Partner Name",
      "Center Code",
      "Center Name",
      "State",
      "Method",
      "Unique UTR No",
      "Transaction ID",
      "Amount (INR)",
      "Status",
      "Remarks / Exemption",
    ];

    const rows = filteredDeposits.map((d) => {
      const locData = d.active_partners?.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      const isAdh = isAadhaarDeposit(d);
      const cleanUtr = getCleanUtr(d);
      const cleanTxn = d.transaction_id || cleanUtr;
      const refCode =
        d.reference_code ||
        `${isAdh ? "FA-ADH" : "FA-DEP"}-${String(d.id || "")
          .slice(0, 6)
          .toUpperCase()}`;

      return [
        sanitizeCSV(
          formatToDDMMYYYY(String(d.deposit_date || d.created_at).split("T")[0])
        ),
        sanitizeCSV(refCode),
        sanitizeCSV(isAdh ? "AADHAAR KENDRA" : "BSNL + PAYBULL"),
        sanitizeCSV(d.active_partners?.partner_name || "N/A"),
        sanitizeCSV(loc?.center_code || "NO-CODE"),
        sanitizeCSV(loc?.center_name || "Unassigned"),
        sanitizeCSV(loc?.state || "N/A"),
        sanitizeCSV(d.deposit_method),
        sanitizeCSV(cleanUtr),
        sanitizeCSV(cleanTxn),
        Number(d.deposit_amount || 0).toFixed(2),
        sanitizeCSV(d.status),
        sanitizeCSV(d.rejection_reason || d.exemption_reason || ""),
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_DRS_Deposit_Verification_${formatToDDMMYYYY(
      toDate
    ).replace(/\//g, "-")}.csv`;
    link.click();
  };

  // Mapped Bank / UPI Channels for Currently Selected Deposit's Center
  const selectedCenterChannels = useMemo(() => {
    if (!selectedDeposit) return { vas: [], upis: [] };
    const locData = selectedDeposit.active_partners?.locations;
    const loc: any = Array.isArray(locData) ? locData[0] : locData;
    const candidateIds = [
      selectedDeposit.center_id,
      selectedDeposit.active_partners?.center_id,
      loc?.id,
      loc?.parent_master_id,
    ].filter(Boolean);

    return {
      vas: virtualAccounts.filter((v) =>
        candidateIds.includes(v.assigned_location_id)
      ),
      upis: upiIds.filter((u) => candidateIds.includes(u.assigned_location_id)),
    };
  }, [selectedDeposit, virtualAccounts, upiIds]);

  const totalPendingAmt = filteredDeposits
    .filter((d) => String(d.status || "").includes("Pending"))
    .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);

  const totalVerifiedAmt = filteredDeposits
    .filter((d) => d.status === "Verified")
    .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);

  const totalDiscrepancyAmt = filteredDeposits
    .filter((d) => d.status === "Discrepancy")
    .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-[1500px] mx-auto space-y-6">
        {/* HEADER */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <Link
              href="/dashboard"
              className="text-blue-600 font-black text-xs uppercase tracking-widest mb-1.5 hover:underline inline-block"
            >
              &larr; Back to DRS Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span>🏦</span> Deposit Verification
            </h1>
            <p className="text-slate-500 text-sm font-medium mt-1">
              Verify partner bank slips side-by-side with Unique UTR,
              Transaction ID, Center Banking Credentials, and Reference Codes.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={initializeAccountsPortal}
              className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition"
            >
              ↻ Refresh Queue
            </button>
            <button
              onClick={handleExportCSV}
              className="bg-slate-900 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md transition"
            >
              📥 Export Filtered CSV ({filteredDeposits.length})
            </button>
          </div>
        </div>

        {/* SUMMARY STRIP */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 border-l-4 border-l-amber-500 shadow-sm">
            <p className="text-[10px] font-black uppercase text-amber-700 tracking-widest">
              Pending Verification
            </p>
            <p className="text-2xl font-black text-slate-900 mt-1">
              ₹{totalPendingAmt.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 shadow-sm">
            <p className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">
              Verified &amp; Cleared
            </p>
            <p className="text-2xl font-black text-emerald-700 mt-1">
              ₹{totalVerifiedAmt.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 border-l-4 border-l-red-500 shadow-sm">
            <p className="text-[10px] font-black uppercase text-red-700 tracking-widest">
              Flagged Discrepancies
            </p>
            <p className="text-2xl font-black text-red-600 mt-1">
              ₹{totalDiscrepancyAmt.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-900 text-white p-5 rounded-xl shadow-sm">
            <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">
              Active Filter Window
            </p>
            <p className="text-lg font-black text-white mt-1">
              {formatToDDMMYYYY(fromDate)} &rarr; {formatToDDMMYYYY(toDate)}
            </p>
          </div>
        </div>

        {/* FILTER CONSOLE */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                1. State
              </label>
              <select
                value={fState}
                onChange={(e) => {
                  setFState(e.target.value);
                  setFHq("ALL");
                  setFCenter("ALL");
                  setFPartner("ALL");
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50"
              >
                <option value="ALL">All States</option>
                {uniqueStates.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                2. Master HQ
              </label>
              <select
                value={fHq}
                onChange={(e) => {
                  setFHq(e.target.value);
                  setFCenter("ALL");
                  setFPartner("ALL");
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50"
              >
                <option value="ALL">All Master HQs</option>
                {hqOptions.map((hq) => (
                  <option key={hq.id} value={hq.id}>
                    {hq.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                3. Center / Location
              </label>
              <select
                value={fCenter}
                onChange={(e) => {
                  setFCenter(e.target.value);
                  setFPartner("ALL");
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50"
              >
                <option value="ALL">All Centers</option>
                {centerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.center_code || "NO-CODE"}] {c.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                4. Partner
              </label>
              <select
                value={fPartner}
                onChange={(e) => setFPartner(e.target.value)}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50"
              >
                <option value="ALL">All Partners</option>
                {partnerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partner_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-indigo-600 mb-1">
                5. Business Vertical
              </label>
              <select
                value={fStream}
                onChange={(e) => setFStream(e.target.value as any)}
                className="w-full border-2 border-indigo-200 p-2 rounded-lg text-xs font-black bg-indigo-50 text-indigo-950"
              >
                <option value="ALL">🌐 All Verticals</option>
                <option value="TELECOM">📡 BSNL + Paybull</option>
                <option value="AADHAAR">🆔 Aadhaar Kendra</option>
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-emerald-700 mb-1">
                6. Audit Status
              </label>
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value as any)}
                className="w-full border-2 border-emerald-200 p-2 rounded-lg text-xs font-black bg-emerald-50 text-emerald-950"
              >
                <option value="Pending">⏳ Pending Action</option>
                <option value="Verified">✅ Verified</option>
                <option value="Discrepancy">❌ Discrepancy</option>
                <option value="ALL">📋 All Statuses</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                Date Preset
              </label>
              <select
                value={datePreset}
                onChange={(e) =>
                  handlePresetChange(e.target.value as DatePresetMode)
                }
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-black bg-slate-50"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="current_week">Current Week</option>
                <option value="current_month">Current Month</option>
                <option value="previous_month">Previous Month</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                From ({formatToDDMMYYYY(fromDate)})
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setFromDate(e.target.value);
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                To ({formatToDDMMYYYY(toDate)})
              </label>
              <input
                type="date"
                value={toDate}
                max={getISTDateString(0)}
                onChange={(e) => {
                  setDatePreset("custom");
                  setToDate(e.target.value);
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                Search UTR / Ref Code / Partner
              </label>
              <input
                type="text"
                placeholder="Search UTR, Txn ID, Ref Code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50 focus:bg-white"
              />
            </div>
          </div>
        </div>

        {/* SPLIT PANE: DEPOSIT QUEUE + SIDE-BY-SIDE SLIP INSPECTOR */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest">
                Remittance Queue ({filteredDeposits.length})
              </h3>
              <span className="text-[10px] font-bold text-slate-400">
                Click any row to inspect slip &amp; verify
              </span>
            </div>
            <div className="overflow-x-auto max-h-[680px]">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b sticky top-0">
                  <tr>
                    <th className="p-3.5">Date &amp; Ref Code</th>
                    <th className="p-3.5">Partner &amp; Center</th>
                    <th className="p-3.5">UTR &amp; Method</th>
                    <th className="p-3.5 text-right">Amount (₹)</th>
                    <th className="p-3.5 text-center">Status</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDeposits.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-12 text-center text-slate-400 font-bold"
                      >
                        No deposits match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredDeposits.map((dep) => {
                      const locData = dep.active_partners?.locations;
                      const loc: any = Array.isArray(locData)
                        ? locData[0]
                        : locData;
                      const isAdh = isAadhaarDeposit(dep);
                      const cleanUtr = getCleanUtr(dep);
                      const isDupUtr = (utrFrequencyMap[cleanUtr] || 0) > 1;
                      const refCode =
                        dep.reference_code ||
                        `${isAdh ? "FA-ADH" : "FA-DEP"}-${String(dep.id || "")
                          .slice(0, 6)
                          .toUpperCase()}`;
                      const isSelected = selectedDeposit?.id === dep.id;

                      return (
                        <tr
                          key={dep.id}
                          onClick={() => handleInspectDeposit(dep)}
                          className={`cursor-pointer transition ${
                            isSelected
                              ? "bg-blue-50/90"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="p-3.5">
                            <p className="font-black text-slate-900">
                              {formatToDDMMYYYY(
                                String(
                                  dep.deposit_date || dep.created_at
                                ).split("T")[0]
                              )}
                            </p>
                            <span className="font-mono text-[10px] font-black text-indigo-700">
                              {refCode}
                            </span>
                          </td>
                          <td className="p-3.5">
                            <p className="font-black text-slate-800">
                              {dep.active_partners?.partner_name}
                            </p>
                            <p className="text-[10px] font-bold text-slate-500">
                              [{loc?.center_code || "NO-CODE"}]{" "}
                              {loc?.center_name}
                            </p>
                          </td>
                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                  isAdh
                                    ? "bg-amber-100 text-amber-900"
                                    : "bg-indigo-100 text-indigo-900"
                                }`}
                              >
                                {isAdh ? "🆔 Aadhaar" : "📡 Telecom"} •{" "}
                                {dep.deposit_method}
                              </span>
                              {isDupUtr && (
                                <span className="bg-red-600 text-white text-[8px] font-black uppercase px-1.5 py-0.5 rounded animate-pulse">
                                  🚨 DUP UTR
                                </span>
                              )}
                            </div>
                            <p className="font-mono font-black text-slate-900 mt-1">
                              UTR: {cleanUtr}
                            </p>
                          </td>
                          <td className="p-3.5 text-right font-black text-sm text-slate-900">
                            ₹
                            {Number(dep.deposit_amount).toLocaleString("en-IN")}
                          </td>
                          <td className="p-3.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                dep.status === "Verified"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : dep.status === "Discrepancy"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {dep.status}
                            </span>
                          </td>
                          <td className="p-3.5 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInspectDeposit(dep);
                              }}
                              className="bg-slate-900 hover:bg-blue-600 text-white font-black px-3 py-1.5 rounded text-[10px] uppercase"
                            >
                              Inspect &rarr;
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT PANE: OCR SLIP INSPECTOR, BANK CREDENTIALS & VERIFICATION CONTROLS */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden lg:sticky lg:top-8">
            <div className="p-4 bg-slate-950 text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest text-amber-400">
                🔍 Side-by-Side Receipt &amp; UTR Inspector
              </h3>
              {selectedDeposit && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingDeposit(!isEditingDeposit)}
                    className="bg-slate-800 hover:bg-blue-600 text-white px-2.5 py-1 rounded text-[10px] font-black uppercase transition"
                  >
                    {isEditingDeposit ? "✕ Cancel Edit" : "✏️ Edit UTR / Amt"}
                  </button>
                  <button
                    onClick={() => setSelectedDeposit(null)}
                    className="text-xs font-black text-slate-400 hover:text-white px-1"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {!selectedDeposit ? (
              <div className="p-12 text-center text-slate-400 font-bold text-sm">
                Select any remittance row on the left to inspect its uploaded
                bank slip, cross-check Center Banking Credentials, and verify or
                flag discrepancies.
              </div>
            ) : (
              <div className="p-5 space-y-4 text-xs">
                {isEditingDeposit ? (
                  <form
                    onSubmit={handleSaveDepositEdit}
                    className="bg-blue-50/70 p-4 rounded-xl border-2 border-blue-300 space-y-3"
                  >
                    <p className="text-[10px] font-black uppercase text-blue-900">
                      ✏️ Correct Deposit Amount / UTR / Method
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-black uppercase text-slate-600 mb-1">
                          Deposit Amount (₹) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={editDepForm.deposit_amount}
                          onChange={(e) =>
                            setEditDepForm({
                              ...editDepForm,
                              deposit_amount: e.target.value,
                            })
                          }
                          className="w-full border border-blue-300 p-2 rounded-lg font-black bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase text-slate-600 mb-1">
                          Deposit Date *
                        </label>
                        <input
                          type="date"
                          required
                          value={editDepForm.deposit_date}
                          onChange={(e) =>
                            setEditDepForm({
                              ...editDepForm,
                              deposit_date: e.target.value,
                            })
                          }
                          className="w-full border border-blue-300 p-2 rounded-lg font-bold bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase text-slate-600 mb-1">
                          Unique UTR Number *
                        </label>
                        <input
                          type="text"
                          required
                          value={editDepForm.utr_number}
                          onChange={(e) =>
                            setEditDepForm({
                              ...editDepForm,
                              utr_number: e.target.value.toUpperCase(),
                            })
                          }
                          className="w-full border border-blue-300 p-2 rounded-lg font-mono font-black uppercase bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase text-slate-600 mb-1">
                          Transaction ID *
                        </label>
                        <input
                          type="text"
                          required
                          value={editDepForm.transaction_id}
                          onChange={(e) =>
                            setEditDepForm({
                              ...editDepForm,
                              transaction_id: e.target.value.toUpperCase(),
                            })
                          }
                          className="w-full border border-blue-300 p-2 rounded-lg font-mono font-bold uppercase bg-white"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingDeposit(false)}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-black text-[10px] uppercase"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingEdit}
                        className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase shadow"
                      >
                        {isSavingEdit ? "Saving..." : "💾 Save Corrections"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5">
                    <div className="flex justify-between items-center border-b pb-2">
                      <div>
                        <span className="font-black text-sm text-slate-900 block">
                          {selectedDeposit.active_partners?.partner_name}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500">
                          Status:{" "}
                          <strong className="uppercase">
                            {selectedDeposit.status}
                          </strong>
                        </span>
                      </div>
                      <span className="font-black text-xl text-emerald-700">
                        ₹
                        {Number(selectedDeposit.deposit_amount).toLocaleString(
                          "en-IN"
                        )}
                      </span>
                    </div>

                    {(utrFrequencyMap[getCleanUtr(selectedDeposit)] || 0) >
                      1 && (
                      <div className="p-2.5 bg-red-100 border border-red-300 rounded-lg text-red-900 font-black text-[11px]">
                        🚨 WARNING: UTR &quot;{getCleanUtr(selectedDeposit)}
                        &quot; appears{" "}
                        {utrFrequencyMap[getCleanUtr(selectedDeposit)]} times in
                        this date window!
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <span className="text-[9px] font-bold uppercase text-slate-400 block">
                          Unique UTR Number
                        </span>
                        <span className="font-mono font-black text-slate-900">
                          {getCleanUtr(selectedDeposit)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase text-slate-400 block">
                          Transaction / Scroll ID
                        </span>
                        <span className="font-mono font-bold text-slate-800">
                          {selectedDeposit.transaction_id ||
                            getCleanUtr(selectedDeposit)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase text-slate-400 block">
                          Deposit Date
                        </span>
                        <span className="font-bold text-slate-800">
                          {formatToDDMMYYYY(
                            String(
                              selectedDeposit.deposit_date ||
                                selectedDeposit.created_at
                            ).split("T")[0]
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase text-slate-400 block">
                          Method &amp; Vertical
                        </span>
                        <span className="font-bold text-blue-700">
                          {selectedDeposit.deposit_method} (
                          {isAadhaarDeposit(selectedDeposit)
                            ? "Aadhaar Kendra"
                            : "BSNL + Paybull"}
                          )
                        </span>
                      </div>
                    </div>

                    {/* MAPPED CENTER BANKING CREDENTIALS REFERENCE */}
                    <div className="pt-2 border-t border-slate-200 space-y-1">
                      <span className="text-[9px] font-black uppercase text-indigo-600 block">
                        🏦 Mapped Center Banking Credentials (Expected Destination)
                      </span>
                      {selectedCenterChannels.upis.length === 0 &&
                      selectedCenterChannels.vas.length === 0 ? (
                        <p className="text-[10px] text-slate-400 font-bold">
                          No specific CMS/UPI mapped to this center.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedCenterChannels.upis.map((u: any) => (
                            <span
                              key={u.id}
                              className="bg-purple-50 text-purple-900 border border-purple-200 px-2 py-0.5 rounded text-[10px] font-black"
                            >
                              UPI: {u.upi_id} ({u.master_banks?.bank_name})
                            </span>
                          ))}
                          {selectedCenterChannels.vas.map((v: any) => (
                            <span
                              key={v.id}
                              className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-black"
                            >
                              CMS: {v.virtual_account_no} (IFSC:{" "}
                              {v.virtual_ifsc})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* SLIP PREVIEW */}
                {selectedDeposit.is_exempted ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 font-bold">
                    ⚠️ Partner declared Missing Slip Exemption:{" "}
                    <strong>
                      {selectedDeposit.exemption_reason || "No slip attached"}
                    </strong>
                  </div>
                ) : loadingSlip ? (
                  <div className="p-10 text-center text-slate-400 font-bold animate-pulse">
                    Decrypting slip from vault...
                  </div>
                ) : signedSlipUrl ? (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase text-slate-500">
                        Attached Payment Proof
                      </span>
                      <a
                        href={signedSlipUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-black uppercase text-blue-600 hover:underline"
                      >
                        Open Full Screen ↗
                      </a>
                    </div>
                    {String(selectedDeposit.deposit_slip_url || "")
                      .toLowerCase()
                      .endsWith(".pdf") ? (
                      <iframe
                        src={`${signedSlipUrl}#toolbar=0`}
                        className="w-full h-80 rounded-xl border border-slate-300 bg-white"
                        title="Deposit Slip PDF"
                      />
                    ) : (
                      <img
                        src={signedSlipUrl}
                        alt="Deposit Slip"
                        className="w-full max-h-80 object-contain rounded-xl border border-slate-200 bg-slate-900 p-2"
                      />
                    )}
                  </div>
                ) : (
                  <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 text-center text-slate-400 font-bold">
                    No receipt image found on this record.
                  </div>
                )}

                {/* STRUCTURED DISCREPANCY DRAWER */}
                {showDiscrepancyBox && (
                  <div className="bg-red-50 p-4 rounded-xl border-2 border-red-200 space-y-3 animate-in fade-in">
                    <label className="block text-[10px] font-black uppercase text-red-800">
                      Select Discrepancy Reason *
                    </label>
                    <select
                      value={discrepancyPreset}
                      onChange={(e) => {
                        setDiscrepancyPreset(e.target.value);
                        setDiscrepancyCustomText("");
                      }}
                      className="w-full border border-red-300 p-2.5 rounded-lg font-bold bg-white text-slate-900"
                    >
                      <option value="" disabled>
                        -- Choose Discrepancy Reason --
                      </option>
                      {DISCREPANCY_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>

                    {discrepancyPreset === "Other (Specify Below)" && (
                      <input
                        type="text"
                        placeholder="Type detailed discrepancy reason..."
                        value={discrepancyCustomText}
                        onChange={(e) =>
                          setDiscrepancyCustomText(e.target.value)
                        }
                        className="w-full border border-red-300 p-2.5 rounded-lg font-bold bg-white"
                      />
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDiscrepancyBox(false)}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-black text-[10px] uppercase"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={processingId === selectedDeposit.id}
                        onClick={() =>
                          handleAuditAction(selectedDeposit, "Discrepancy")
                        }
                        className="px-4 py-1.5 bg-red-600 text-white rounded-lg font-black text-[10px] uppercase shadow"
                      >
                        Confirm Discrepancy Flag
                      </button>
                    </div>
                  </div>
                )}

                {/* VERIFY / DISCREPANCY / RESET ACTION BUTTONS */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    disabled={
                      processingId === selectedDeposit.id ||
                      selectedDeposit.status === "Verified"
                    }
                    onClick={() =>
                      handleAuditAction(selectedDeposit, "Verified")
                    }
                    className="py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black uppercase tracking-widest rounded-xl shadow transition"
                  >
                    ✅ Approve &amp; Verify
                  </button>
                  <button
                    type="button"
                    disabled={
                      processingId === selectedDeposit.id ||
                      selectedDeposit.status === "Discrepancy"
                    }
                    onClick={() => setShowDiscrepancyBox(true)}
                    className="py-3 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black uppercase tracking-widest rounded-xl shadow transition"
                  >
                    ❌ Flag Discrepancy
                  </button>
                </div>

                {selectedDeposit.status !== "Pending" && (
                  <button
                    type="button"
                    disabled={processingId === selectedDeposit.id}
                    onClick={() =>
                      handleAuditAction(selectedDeposit, "Pending")
                    }
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black uppercase tracking-widest text-[10px] rounded-xl border border-slate-300 transition"
                  >
                    ↺ Reset Status to Pending
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}