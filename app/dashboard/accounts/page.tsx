// FILE PATH: ./app/dashboard/accounts/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { reportAndMaskError, logSystemTelemetry } from "../../lib/errorCodes";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
} from "../../lib/aadhaarEngine";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  return dateStr.split("T")[0];
};

export default function AccountantVerificationDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Master Directory & Deposit Streams
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [allPartners, setAllPartners] = useState<any[]>([]);
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);

  // 7-Option Date Preset + 4-Tier Cascading Filter Engine
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [toDate, setToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );

  const [statusFilter, setStatusFilter] = useState("Pending");
  const [streamFilter, setStreamFilter] = useState<
    "ALL" | "TELECOM" | "AADHAAR"
  >("ALL");
  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fOperator, setFOperator] = useState("ALL");

  // Parallel Viewer Engine
  const [selectedDeposit, setSelectedDeposit] = useState<any | null>(null);
  const [secureImageUrl, setSecureImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Action Engine
  const [processingId, setProcessingId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    setSelectedDeposit(null);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  useEffect(() => {
    fetchDeposits();
  }, [fromDate, toDate]);

  const fetchDeposits = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [locRes, partRes, depRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"),
        supabase
          .from("active_partners")
          .select(
            "id, partner_name, email, role, role_aadhaar, aadhaar_operator_id, aadhaar_station_id, center_id, locations (id, state, dist, center_name, center_code, parent_master_id)"
          )
          .order("partner_name"),
        supabase
          .from("partner_deposits")
          .select(
            `
            *,
            active_partners ( id, partner_name, email, aadhaar_operator_id, aadhaar_station_id, locations (id, state, dist, center_name, center_code, parent_master_id, role_aadhaar) )
          `
          )
          .gte("deposit_date", fromDate)
          .lte("deposit_date", toDate)
          .order("deposit_date", { ascending: false }),
      ]);

      if (depRes.error) throw depRes.error;

      setAllLocations(locRes.data || []);
      setAllPartners(partRes.data || []);
      setRawDeposits(depRes.data || []);
    } catch (err: any) {
      await reportAndMaskError(err, "ACCOUNTANT_PORTAL_FETCH");
    } finally {
      setLoading(false);
    }
  };

  const uniqueStates = useMemo(
    () =>
      Array.from(
        new Set(allLocations.map((l) => l.state).filter(Boolean))
      ).sort(),
    [allLocations]
  );

  const hqOptions = useMemo(
    () =>
      allLocations.filter(
        (l) => l.is_master_node && (fState === "ALL" || l.state === fState)
      ),
    [allLocations, fState]
  );

  const locationOptions = useMemo(
    () =>
      allLocations.filter(
        (l) =>
          !l.is_master_node &&
          (fState === "ALL" || l.state === fState) &&
          (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
      ),
    [allLocations, fState, fHq]
  );

  const operatorOptions = useMemo(
    () =>
      allPartners.filter((p) => {
        const locData = p.locations;
        const l: any = Array.isArray(locData) ? locData[0] : locData;
        if (!l) return false;
        if (fState !== "ALL" && l.state !== fState) return false;
        if (fHq !== "ALL" && l.parent_master_id?.toString() !== fHq)
          return false;
        if (fCenter !== "ALL" && l.id?.toString() !== fCenter) return false;
        return true;
      }),
    [allPartners, fState, fHq, fCenter]
  );

  const filteredDeposits = useMemo(() => {
    return rawDeposits.filter((d) => {
      const p = d.active_partners;
      const locData = p?.locations;
      const l: any = Array.isArray(locData) ? locData[0] : locData;

      if (statusFilter !== "All") {
        if (statusFilter === "Pending") {
          if (!d.status?.includes("Pending")) return false;
        } else if (d.status !== statusFilter) {
          return false;
        }
      }

      const isAadhaar =
        d.deposit_stream === "AADHAAR" ||
        String(d.reference_no || "")
          .toUpperCase()
          .startsWith("AADHAAR_");
      if (streamFilter === "AADHAAR" && !isAadhaar) return false;
      if (streamFilter === "TELECOM" && isAadhaar) return false;

      if (fState !== "ALL" && l?.state !== fState) return false;
      if (fHq !== "ALL" && l?.parent_master_id?.toString() !== fHq)
        return false;
      if (fCenter !== "ALL" && l?.id?.toString() !== fCenter) return false;
      if (
        fOperator !== "ALL" &&
        d.partner_id !== fOperator &&
        p?.id !== fOperator
      )
        return false;

      return true;
    });
  }, [
    rawDeposits,
    statusFilter,
    streamFilter,
    fState,
    fHq,
    fCenter,
    fOperator,
  ]);

  useEffect(() => {
    const decryptImage = async () => {
      setSecureImageUrl(null);
      setImageError(null);

      if (!selectedDeposit) return;
      if (selectedDeposit.is_exempted || !selectedDeposit.deposit_slip_url)
        return;

      setImageLoading(true);
      try {
        if (selectedDeposit.deposit_slip_url.startsWith("http")) {
          setSecureImageUrl(selectedDeposit.deposit_slip_url);
          return;
        }

        const { data, error } = await supabase.storage
          .from("deposit-slips")
          .createSignedUrl(selectedDeposit.deposit_slip_url, 3600);

        if (error) throw error;
        if (!data || !data.signedUrl) {
          throw new Error("Signed URL generation failed.");
        }

        setSecureImageUrl(data.signedUrl);
      } catch (err: any) {
        const safeMsg = await reportAndMaskError(
          err,
          "ACCOUNTANT_SLIP_DECRYPT"
        );
        setImageError(safeMsg);
      } finally {
        setImageLoading(false);
      }
    };

    decryptImage();
  }, [selectedDeposit]);

  // --- CORE ACTION ENGINE (WITH ISOLATED PENALTY REVERSAL & 3-IDENTIFIER LOGS) ---
  const handleUpdateStatus = async (newStatus: "Verified" | "Discrepancy") => {
    if (!selectedDeposit) return;
    if (
      newStatus === "Verified" &&
      !confirm(
        `Confirm verification of ₹${selectedDeposit.deposit_amount}? This permanently clears this amount from the partner's ledger.`
      )
    )
      return;
    if (newStatus === "Discrepancy" && rejectionReason.trim().length < 5)
      return alert(
        "You must provide a detailed reason for flagging a discrepancy."
      );

    setProcessingId(selectedDeposit.id);

    try {
      const updatePayload: any = { status: newStatus };
      if (newStatus === "Discrepancy") {
        updatePayload.rejection_reason = rejectionReason;
      }

      const { error } = await supabase
        .from("partner_deposits")
        .update(updatePayload)
        .eq("id", selectedDeposit.id);
      if (error) throw error;

      const isAadhaarDeposit =
        selectedDeposit.deposit_stream === "AADHAAR" ||
        String(selectedDeposit.reference_no || "")
          .toUpperCase()
          .startsWith("AADHAAR_");

      if (newStatus === "Verified") {
        await supabase
          .from("aadhaar_daily_reports")
          .update({ deposit_status: "Settled" })
          .eq("deposit_id", selectedDeposit.id);
      } else if (newStatus === "Discrepancy") {
        await supabase
          .from("aadhaar_daily_reports")
          .update({ deposit_status: "Pending Deposit", deposit_id: null })
          .eq("deposit_id", selectedDeposit.id);

        if (isAadhaarDeposit) {
          // Only revert penalties settled by this specific deposit and never touch Admin-waived rows
          await supabase
            .from("aadhaar_penalty_logs")
            .update({ is_settled: false, settled_by_deposit_id: null })
            .eq("settled_by_deposit_id", selectedDeposit.id)
            .eq("is_waived", false);
        }
      }

      const cleanUtr =
        selectedDeposit.utr_number ||
        String(selectedDeposit.reference_no || "").replace(/^AADHAAR_/i, "");
      const refCode =
        selectedDeposit.reference_code ||
        `${isAadhaarDeposit ? "FA-ADH" : "FA-DEP"}-${String(
          selectedDeposit.id || ""
        )
          .slice(0, 6)
          .toUpperCase()}`;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        await Promise.all([
          supabase.from("staff_activity_logs").insert([
            {
              staff_id: session.user.id,
              staff_email: session.user.email,
              action_type:
                newStatus === "Verified" ? "VERIFICATION" : "DISCREPANCY",
              module: "DEPOSITS",
              target_id: selectedDeposit.id,
              details:
                newStatus === "Verified"
                  ? `Cleared ₹${selectedDeposit.deposit_amount} remittance (Ref: ${refCode} | UTR: ${cleanUtr})`
                  : `Flagged discrepancy on ₹${selectedDeposit.deposit_amount} (Ref: ${refCode} | UTR: ${cleanUtr}): ${rejectionReason}`,
            },
          ]),
          logSystemTelemetry({
            actorId: session.user.id,
            actorEmail: session.user.email,
            actorRole: "Accountant",
            module: "ACCOUNTANT_DEPOSIT_AUDIT",
            actionCode:
              newStatus === "Verified"
                ? "DEPOSIT_VERIFIED"
                : "DEPOSIT_REJECTED",
            referenceId: refCode,
            metadata: {
              deposit_id: selectedDeposit.id,
              amount: selectedDeposit.deposit_amount,
              utr_number: cleanUtr,
              rejection_reason:
                newStatus === "Discrepancy" ? rejectionReason : null,
            },
          }),
        ]);
      }

      if (newStatus === "Discrepancy") {
        await supabase.from("partner_messages").insert([
          {
            partner_id: selectedDeposit.partner_id,
            subject: `🚨 Remittance Discrepancy (${refCode}): ${formatToDDMMYYYY(
              normalizeToYYYYMMDD(
                selectedDeposit.deposit_date || selectedDeposit.created_at
              )
            )}`,
            body: `Your deposit of ₹${selectedDeposit.deposit_amount} (Ref Code: ${refCode} | UTR: ${cleanUtr}) via ${selectedDeposit.deposit_method} has been flagged by Accounts. Reason: ${rejectionReason}. The amount has been restored to your pending balance ledger.`,
          },
        ]);
      }

      setRawDeposits((current) =>
        current.map((d) =>
          d.id === selectedDeposit.id
            ? {
                ...d,
                status: newStatus,
                rejection_reason:
                  newStatus === "Discrepancy" ? rejectionReason : null,
              }
            : d
        )
      );

      setSelectedDeposit(null);
      setShowRejectInput(false);
      setRejectionReason("");
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "ACCOUNTANT_STATUS_UPDATE");
      alert(safeMsg);
    } finally {
      setProcessingId("");
    }
  };

  const downloadCSV = () => {
    if (filteredDeposits.length === 0)
      return alert("No data to export for the current filters.");

    const headers = [
      "Date (DD/MM/YYYY)",
      "System Reference Code",
      "Partner Name",
      "State",
      "Master HQ",
      "District",
      "Center Name",
      "Center Code",
      "Stream",
      "Amount (INR)",
      "Method",
      "Unique UTR No",
      "Transaction ID",
      "Status",
      "Remarks",
    ];

    const csvContent = [
      headers.join(","),
      ...filteredDeposits.map((d) => {
        const p = d.active_partners;
        const locData = p?.locations;
        const l: any = Array.isArray(locData) ? locData[0] : locData;
        const hqName =
          allLocations.find((h) => h.id === l?.parent_master_id)?.center_name ||
          "N/A";
        const isAadhaar =
          d.deposit_stream === "AADHAAR" ||
          String(d.reference_no || "")
            .toUpperCase()
            .startsWith("AADHAAR_");
        const cleanUtr =
          d.utr_number ||
          String(d.reference_no || "").replace(/^AADHAAR_/i, "");
        const cleanTxn = d.transaction_id || cleanUtr;
        const refCode =
          d.reference_code ||
          `${isAadhaar ? "FA-ADH" : "FA-DEP"}-${String(d.id || "")
            .slice(0, 6)
            .toUpperCase()}`;

        return [
          sanitizeCSV(
            formatToDDMMYYYY(
              normalizeToYYYYMMDD(d.deposit_date || d.created_at)
            )
          ),
          sanitizeCSV(refCode),
          sanitizeCSV(p?.partner_name || "N/A"),
          sanitizeCSV(l?.state || "N/A"),
          sanitizeCSV(hqName),
          sanitizeCSV(l?.dist || "N/A"),
          sanitizeCSV(l?.center_name || "N/A"),
          sanitizeCSV(l?.center_code || "NO-CODE"),
          sanitizeCSV(isAadhaar ? "AADHAAR KENDRA" : "TELECOM / PAYBULL"),
          sanitizeCSV(d.deposit_amount),
          sanitizeCSV(d.deposit_method),
          sanitizeCSV(cleanUtr || "N/A"),
          sanitizeCSV(cleanTxn || "N/A"),
          sanitizeCSV(d.status),
          sanitizeCSV(d.rejection_reason || d.exemption_reason || ""),
        ].join(",");
      }),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Deposits_${statusFilter}_${formatToDDMMYYYY(
      fromDate
    ).replace(/\//g, "-")}_to_${formatToDDMMYYYY(toDate).replace(
      /\//g,
      "-"
    )}.csv`;
    link.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  const totalFilteredAmount = filteredDeposits.reduce(
    (sum, d) => sum + Number(d.deposit_amount || 0),
    0
  );

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto bg-slate-50 min-h-screen font-sans">
      {/* HEADER & EXPORT */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-200 pb-6">
        <div>
          <Link
            href="/dashboard"
            className="text-blue-600 font-bold hover:underline mb-2 inline-block"
          >
            &larr; Back to Command Center
          </Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <span className="text-4xl">🏦</span> Accountant Verification Portal
          </h1>
          <p className="text-slate-500 font-medium mt-1">
            Audit Telecom, Paybull, and Aadhaar Seva Kendra remittances with
            Unique UTR, Transaction ID &amp; Reference Code (
            {formatToDDMMYYYY(fromDate)} to {formatToDDMMYYYY(toDate)}).
          </p>
        </div>
        <button
          onClick={downloadCSV}
          className="bg-slate-900 hover:bg-slate-800 text-white font-black px-6 py-3 rounded-lg shadow transition flex items-center gap-2"
        >
          📥 Export {statusFilter} CSV
        </button>
      </div>

      {/* MASTER 4-TIER CASCADING FILTER + 7-PRESET DATE DROPDOWN CONSOLE */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
              1. State
            </label>
            <select
              value={fState}
              onChange={(e) => {
                setFState(e.target.value);
                setFHq("ALL");
                setFCenter("ALL");
                setFOperator("ALL");
                setSelectedDeposit(null);
              }}
              className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
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
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
              2. Master HQ
            </label>
            <select
              value={fHq}
              onChange={(e) => {
                setFHq(e.target.value);
                setFCenter("ALL");
                setFOperator("ALL");
                setSelectedDeposit(null);
              }}
              className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
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
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
              3. Location (Center)
            </label>
            <select
              value={fCenter}
              onChange={(e) => {
                setFCenter(e.target.value);
                setFOperator("ALL");
                setSelectedDeposit(null);
              }}
              className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
            >
              <option value="ALL">All Locations</option>
              {locationOptions.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.center_name} [{loc.center_code || "NO-CODE"}]
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
              4. Operator / Partner
            </label>
            <select
              value={fOperator}
              onChange={(e) => {
                setFOperator(e.target.value);
                setSelectedDeposit(null);
              }}
              className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
            >
              <option value="ALL">
                All Operators ({operatorOptions.length})
              </option>
              {operatorOptions.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.partner_name}{" "}
                  {op.aadhaar_station_id
                    ? `(Stn: ${op.aadhaar_station_id})`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-100">
          <div>
            <label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">
              5. Date Preset
            </label>
            <select
              value={datePreset}
              onChange={(e) =>
                handlePresetChange(e.target.value as DatePresetMode)
              }
              className="w-full bg-indigo-50 border-2 border-indigo-200 text-indigo-950 font-black text-xs rounded-lg p-2.5 outline-none focus:border-indigo-600"
            >
              <option value="today">
                Today ({formatToDDMMYYYY(getDateRangeFromPreset("today").start)})
              </option>
              <option value="yesterday">
                Yesterday (
                {formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})
              </option>
              <option value="current_week">Current Week</option>
              <option value="current_month">Current Month</option>
              <option value="previous_month">Previous Month</option>
              <option value="all">All Time</option>
              <option value="custom">Custom Filter</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
              From ({formatToDDMMYYYY(fromDate)})
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setDatePreset("custom");
                setFromDate(e.target.value);
                setSelectedDeposit(null);
              }}
              className="w-full bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2 outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
              To ({formatToDDMMYYYY(toDate)})
            </label>
            <input
              type="date"
              value={toDate}
              max={getISTDateString(0)}
              onChange={(e) => {
                setDatePreset("custom");
                setToDate(e.target.value);
                setSelectedDeposit(null);
              }}
              className="w-full bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2 outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-amber-700 uppercase tracking-widest block mb-1">
              6. Revenue Stream
            </label>
            <select
              value={streamFilter}
              onChange={(e) => {
                setStreamFilter(e.target.value as any);
                setSelectedDeposit(null);
              }}
              className="w-full bg-amber-50 border-2 border-amber-200 text-amber-950 font-black text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
            >
              <option value="ALL">📋 All Streams</option>
              <option value="TELECOM">📡 Telecom &amp; Paybull</option>
              <option value="AADHAAR">🆔 Aadhaar Kendra Only</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
              7. Audit Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setSelectedDeposit(null);
              }}
              className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-black text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
            >
              <option value="All">All Statuses</option>
              <option value="Pending">⏳ Pending Audit</option>
              <option value="Verified">✅ Verified (Approved)</option>
              <option value="Discrepancy">❌ Discrepancy (Rejected)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT PANE: QUEUE / LEDGER */}
        <div
          className="xl:col-span-5 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden sticky top-6"
          style={{ maxHeight: "calc(100vh - 2rem)" }}
        >
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
            <div>
              <h3 className="font-black tracking-widest uppercase text-sm">
                Action Queue
              </h3>
              <p className="text-[10px] text-slate-400 font-bold mt-1">
                Select a row to inspect slip, UTR, Txn ID &amp; Ref Code.
              </p>
            </div>
            <div className="text-right">
              <p className="font-black text-lg">{filteredDeposits.length}</p>
              <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">
                ₹{totalFilteredAmount.toLocaleString("en-IN")}
              </p>
            </div>
          </div>

          <div
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 8rem)" }}
          >
            {filteredDeposits.length === 0 ? (
              <div className="p-12 text-center">
                <span className="text-4xl mb-3 block">☕</span>
                <p className="text-slate-500 font-bold">
                  No records match your cascading filters.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredDeposits.map((dep) => {
                  const isSelected = selectedDeposit?.id === dep.id;
                  const isAadhaar =
                    dep.deposit_stream === "AADHAAR" ||
                    String(dep.reference_no || "")
                      .toUpperCase()
                      .startsWith("AADHAAR_");
                  const locData = dep.active_partners?.locations;
                  const l: any = Array.isArray(locData) ? locData[0] : locData;
                  const cleanUtr =
                    dep.utr_number ||
                    String(dep.reference_no || "").replace(/^AADHAAR_/i, "");
                  const refCode =
                    dep.reference_code ||
                    `${isAadhaar ? "FA-ADH" : "FA-DEP"}-${String(dep.id || "")
                      .slice(0, 6)
                      .toUpperCase()}`;

                  return (
                    <li
                      key={dep.id}
                      onClick={() => {
                        setSelectedDeposit(dep);
                        setShowRejectInput(false);
                      }}
                      className={`p-4 cursor-pointer transition border-l-4 ${
                        isSelected
                          ? "bg-amber-50 border-amber-500"
                          : "hover:bg-slate-50 border-transparent"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-black text-slate-900 leading-tight">
                            {dep.active_partners?.partner_name}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                            [{l?.center_code || "NO-CODE"}] {l?.center_name} (
                            {l?.state})
                          </p>
                          <span className="font-mono text-[10px] font-black text-indigo-700 mt-1 inline-block">
                            {refCode}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`text-lg font-black ${
                              dep.status === "Discrepancy"
                                ? "text-slate-400 line-through"
                                : "text-slate-800"
                            }`}
                          >
                            ₹
                            {Number(dep.deposit_amount).toLocaleString("en-IN")}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500">
                            {formatToDDMMYYYY(
                              normalizeToYYYYMMDD(
                                dep.deposit_date || dep.created_at
                              )
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex justify-between items-center mt-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isAadhaar && (
                            <span className="text-[9px] font-black bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded uppercase tracking-widest">
                              🆔 Aadhaar
                            </span>
                          )}
                          <span className="text-[9px] font-black bg-slate-200 text-slate-700 px-2 py-0.5 rounded uppercase tracking-widest">
                            {dep.deposit_method}
                          </span>
                          <span className="text-[10px] font-black text-slate-700 tracking-wider truncate max-w-[140px]">
                            UTR: {cleanUtr}
                          </span>
                        </div>
                        <span
                          className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                            dep.status === "Verified"
                              ? "bg-green-100 text-green-700 border-green-200"
                              : dep.status === "Discrepancy"
                              ? "bg-red-100 text-red-700 border-red-200"
                              : "bg-amber-100 text-amber-700 border-amber-200"
                          }`}
                        >
                          {dep.status}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT PANE: PARALLEL INSPECTION VIEWER */}
        <div
          className="xl:col-span-7 sticky top-6 flex flex-col gap-4"
          style={{ height: "calc(100vh - 2rem)" }}
        >
          {!selectedDeposit ? (
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <span className="text-6xl mb-4 opacity-50">👈</span>
              <h2 className="text-xl font-black text-slate-600 uppercase tracking-widest">
                Select a Record
              </h2>
              <p className="font-bold mt-2 text-sm">
                Click any row in the left queue to inspect the deposit slip,
                Unique UTR, Transaction ID, and Reference Code side-by-side.
              </p>
            </div>
          ) : (
            <>
              {/* Top Action Header with All 3 Identifiers */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-black bg-indigo-50 text-indigo-800 border border-indigo-200 px-2.5 py-0.5 rounded">
                      {selectedDeposit.reference_code ||
                        `${
                          selectedDeposit.deposit_stream === "AADHAAR" ||
                          String(selectedDeposit.reference_no || "")
                            .toUpperCase()
                            .startsWith("AADHAAR_")
                            ? "FA-ADH"
                            : "FA-DEP"
                        }-${String(selectedDeposit.id || "")
                          .slice(0, 6)
                          .toUpperCase()}`}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                      Date:{" "}
                      {formatToDDMMYYYY(
                        normalizeToYYYYMMDD(
                          selectedDeposit.deposit_date ||
                            selectedDeposit.created_at
                        )
                      )}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <p className="text-3xl font-black text-slate-900">
                      ₹
                      {Number(selectedDeposit.deposit_amount).toLocaleString(
                        "en-IN"
                      )}
                    </p>
                    <p className="text-xs font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-1 rounded">
                      {selectedDeposit.deposit_method}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs font-bold text-slate-700 pt-1">
                    <span>
                      Unique UTR:{" "}
                      <strong className="text-slate-950 font-black">
                        {selectedDeposit.utr_number ||
                          String(selectedDeposit.reference_no || "").replace(
                            /^AADHAAR_/i,
                            ""
                          )}
                      </strong>
                    </span>
                    <span>&bull;</span>
                    <span>
                      Txn ID:{" "}
                      <strong className="text-slate-900">
                        {selectedDeposit.transaction_id ||
                          selectedDeposit.reference_no}
                      </strong>
                    </span>
                  </div>
                </div>

                {selectedDeposit.status === "Pending" ||
                selectedDeposit.status === "Pending Verification" ? (
                  showRejectInput ? (
                    <div className="flex-1 w-full bg-red-50 p-3 rounded-lg border border-red-200 animate-in fade-in">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Type discrepancy reason..."
                        className="w-full border-2 border-red-300 rounded p-2 text-sm outline-none focus:border-red-600 mb-2 font-bold"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdateStatus("Discrepancy")}
                          disabled={!!processingId}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-2 rounded text-xs uppercase tracking-widest transition shadow"
                        >
                          {processingId ? "..." : "Confirm Reject"}
                        </button>
                        <button
                          onClick={() => setShowRejectInput(false)}
                          disabled={!!processingId}
                          className="bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 font-black px-4 py-2 rounded text-xs uppercase tracking-widest transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => handleUpdateStatus("Verified")}
                        disabled={!!processingId}
                        className="flex-1 sm:flex-none bg-green-500 hover:bg-green-600 text-white font-black px-6 py-3 rounded-lg shadow-md uppercase tracking-widest text-xs transition"
                      >
                        {processingId ? "..." : "✅ Approve"}
                      </button>
                      <button
                        onClick={() => setShowRejectInput(true)}
                        disabled={!!processingId}
                        className="bg-white hover:bg-red-50 border-2 border-red-200 hover:border-red-500 text-red-600 font-black px-4 py-3 rounded-lg shadow-sm uppercase tracking-widest text-xs transition"
                      >
                        Reject
                      </button>
                    </div>
                  )
                ) : (
                  <div
                    className={`px-6 py-3 rounded-lg border ${
                      selectedDeposit.status === "Verified"
                        ? "bg-green-50 border-green-200 text-green-700"
                        : "bg-red-50 border-red-200 text-red-700"
                    }`}
                  >
                    <p className="font-black uppercase tracking-widest text-xs">
                      {selectedDeposit.status}
                    </p>
                    {selectedDeposit.rejection_reason && (
                      <p className="text-[10px] font-bold mt-1">
                        Reason: {selectedDeposit.rejection_reason}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Image / PDF Viewer */}
              <div className="flex-1 bg-slate-900 rounded-xl shadow-inner border border-slate-800 flex items-center justify-center overflow-hidden p-2 relative">
                {selectedDeposit.is_exempted ? (
                  <div className="text-center p-8 bg-slate-800 border border-amber-500/50 rounded-2xl max-w-md shadow-2xl">
                    <span className="text-6xl">⚠️</span>
                    <h3 className="text-amber-500 font-black uppercase tracking-widest mt-4">
                      Slip Exempted
                    </h3>
                    <p className="text-slate-300 text-sm font-bold mt-3 p-4 bg-slate-900 rounded">
                      &quot;{selectedDeposit.exemption_reason}&quot;
                    </p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-4 font-black">
                      Audit manually via bank portal using UTR:{" "}
                      {selectedDeposit.utr_number ||
                        selectedDeposit.reference_no}
                    </p>
                  </div>
                ) : imageLoading ? (
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                    <p className="text-blue-400 font-bold text-xs uppercase tracking-widest animate-pulse">
                      Decrypting Vault Document...
                    </p>
                  </div>
                ) : imageError ? (
                  <div className="text-center p-6 bg-red-950/50 border border-red-900 rounded-2xl max-w-md shadow-2xl flex flex-col items-center">
                    <span className="text-4xl">🚫</span>
                    <h3 className="text-red-500 font-black uppercase tracking-widest mt-4">
                      Storage Access Failed
                    </h3>
                    <p className="text-red-300 text-xs font-bold mt-2 bg-red-950 p-3 rounded">
                      {imageError}
                    </p>
                  </div>
                ) : secureImageUrl ? (
                  <div className="w-full h-full flex justify-center items-center overflow-auto p-4 relative group">
                    {String(selectedDeposit.deposit_slip_url || "")
                      .toLowerCase()
                      .endsWith(".pdf") ? (
                      <iframe
                        src={`${secureImageUrl}#toolbar=0`}
                        className="w-full h-full rounded shadow-2xl border border-slate-700 bg-white"
                        title="Decrypted PDF Proof"
                      />
                    ) : (
                      <img
                        src={secureImageUrl}
                        alt="Decrypted Deposit Proof"
                        className="max-w-full h-auto object-contain rounded shadow-2xl transition-transform duration-300 bg-white"
                        style={{ maxHeight: "100%" }}
                        onError={() => {
                          setSecureImageUrl(null);
                          setImageError(
                            "[ERR-VLT-301] The image failed to load or bucket permissions blocked access."
                          );
                        }}
                      />
                    )}

                    <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <a
                        href={secureImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-slate-900/80 hover:bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest px-4 py-2 rounded shadow-lg backdrop-blur-sm transition border border-slate-700"
                      >
                        Open Full Screen ↗
                      </a>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-600 font-black text-sm uppercase tracking-widest">
                    Document unavailable or deleted.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}