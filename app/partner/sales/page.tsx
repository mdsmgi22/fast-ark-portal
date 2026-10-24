// FILE PATH: ./app/partner/sales/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { reportAndMaskError, logSystemTelemetry } from "../../lib/errorCodes";
import { formatToDDMMYYYY, getISTDateString } from "../../lib/aadhaarEngine";

export default function PartnerSalesReport() {
  const router = useRouter();
  const [partner, setPartner] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Mobile Accordion Section State (0 = All Open on Mobile, 1..5 = Specific Section)
  const [mobileSection, setMobileSection] = useState<number>(1);

  // Live OCSC / Telecom Cash Collection vs Deposit Summary
  const [ledgerSummary, setLedgerSummary] = useState({
    totalCollected: 0,
    totalDeposited: 0,
    balancePayable: 0,
  });

  // Edit Mode State
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Mandatory Submission Verification State
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const [form, setForm] = useState({
    report_date: getISTDateString(0),

    // 1. BSNL CBP
    cbp_landline_qty: 0,
    cbp_landline_amt: 0,
    cbp_gsm_qty: 0,
    cbp_gsm_amt: 0,

    // 2. BSNL CTOP & FRC
    ctop_recharge_qty: 0,
    ctop_recharge_amt: 0,
    frc_qty: 0,
    frc_amt: 0,

    // 3. BSNL SIM Tracking
    mnp_qty: 0,
    mnp_amt: 0,
    sim_new_qty: 0,
    sim_upgrade_qty: 0,
    sim_postpaid_qty: 0,
    sim_postpaid_amt: 0,
    sim_replacement_qty: 0,
    sim_replacement_amt: 0,
    sim_fancy_qty: 0,
    sim_fancy_amt: 0,

    // 4. Adjustments
    cheque_qty: 0,
    cheque_amt: 0,
    other_details: "",
    other_amt: 0,

    // 5. PAYBULL PLATFORM (Isolated)
    pb_cbp_amt: 0,
    pb_ctop_amt: 0,
    pb_frc_amt: 0,
    pb_mnp_amt: 0,
    pb_other_amt: 0,

    zero_business_reason: "",
  });

  useEffect(() => {
    const initialize = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          router.push("/partner/login");
          return;
        }

        const { data: partnerData } = await supabase
          .from("active_partners")
          .select(
            "id, partner_name, email, role, center_id, locations(center_name, center_code)"
          )
          .ilike("email", session.user.email || "")
          .maybeSingle();

        if (!partnerData) {
          setSyncError(
            "[ERR-REL-203] Your partner profile could not be loaded. Please sign out and contact administration."
          );
          setLoading(false);
          return;
        }

        setPartner(partnerData);

        // Fetch Historical Telecom Sales & Deposits for Live Balance Payable Banner
        const [salesHistRes, depHistRes, approvedEditRes] = await Promise.all([
          supabase
            .from("daily_sales_reports")
            .select("*")
            .eq("partner_id", partnerData.id),
          supabase
            .from("partner_deposits")
            .select("deposit_amount, status, reference_no, deposit_stream")
            .eq("partner_id", partnerData.id)
            .neq("status", "Discrepancy"),
          supabase
            .from("daily_sales_reports")
            .select("*")
            .eq("partner_id", partnerData.id)
            .eq("edit_request_status", "Approved")
            .limit(1)
            .maybeSingle(),
        ]);

        let histSalesTotal = 0;
        (salesHistRes.data || []).forEach((s: any) => {
          histSalesTotal +=
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

        let histDepTotal = 0;
        (depHistRes.data || [])
          .filter(
            (d: any) =>
              d.deposit_stream !== "AADHAAR" &&
              !String(d.reference_no || "")
                .toUpperCase()
                .startsWith("AADHAAR_")
          )
          .forEach((d: any) => {
            histDepTotal += Number(d.deposit_amount || 0);
          });

        setLedgerSummary({
          totalCollected: histSalesTotal,
          totalDeposited: histDepTotal,
          balancePayable: Math.max(0, histSalesTotal - histDepTotal),
        });

        // AUTO-DETECT APPROVED EDITS & APPROVED BACKDATES
        const approvedEdit = approvedEditRes.data;
        if (approvedEdit) {
          setIsEditMode(true);
          setEditingId(approvedEdit.id);
          setForm({
            report_date: approvedEdit.report_date,
            cbp_landline_qty: approvedEdit.cbp_landline_qty,
            cbp_landline_amt: approvedEdit.cbp_landline_amt,
            cbp_gsm_qty: approvedEdit.cbp_gsm_qty,
            cbp_gsm_amt: approvedEdit.cbp_gsm_amt,
            ctop_recharge_qty: approvedEdit.ctop_recharge_qty,
            ctop_recharge_amt: approvedEdit.ctop_recharge_amt,
            frc_qty: approvedEdit.frc_qty || 0,
            frc_amt: approvedEdit.frc_amt || 0,
            mnp_qty: approvedEdit.mnp_qty || 0,
            mnp_amt: approvedEdit.mnp_amt || 0,
            sim_new_qty: approvedEdit.sim_new_qty,
            sim_upgrade_qty: approvedEdit.sim_upgrade_qty,
            sim_postpaid_qty: approvedEdit.sim_postpaid_qty,
            sim_postpaid_amt: approvedEdit.sim_postpaid_amt,
            sim_replacement_qty: approvedEdit.sim_replacement_qty,
            sim_replacement_amt: approvedEdit.sim_replacement_amt,
            sim_fancy_qty: approvedEdit.sim_fancy_qty,
            sim_fancy_amt: approvedEdit.sim_fancy_amt,
            cheque_qty: approvedEdit.cheque_qty,
            cheque_amt: approvedEdit.cheque_amt,
            other_details: approvedEdit.other_details || "",
            other_amt: approvedEdit.other_amt,
            pb_cbp_amt: approvedEdit.pb_cbp_amt || 0,
            pb_ctop_amt: approvedEdit.pb_ctop_amt || 0,
            pb_frc_amt: approvedEdit.pb_frc_amt || 0,
            pb_mnp_amt: approvedEdit.pb_mnp_amt || 0,
            pb_other_amt: approvedEdit.pb_other_amt || 0,
            zero_business_reason: approvedEdit.zero_business_reason || "",
          });
        }
      } catch (err: any) {
        await reportAndMaskError(err, "PARTNER_SALES_INIT");
      } finally {
        setLoading(false);
      }
    };
    initialize();
  }, [router]);

  const handleInputChange = (field: string, value: string) => {
    const isQtyField = field.includes("qty");
    const num = isQtyField ? parseInt(value, 10) : parseFloat(value);
    setForm((prev) => ({ ...prev, [field]: isNaN(num) || num < 0 ? 0 : num }));
  };

  // Strict Input Sanitization & Scroll Locks
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowUp", "ArrowDown", "e", "E", "+", "-"].includes(e.key)) {
      e.preventDefault();
    }
  };

  // Dynamic IST-Safe Time Engine
  const calculateDiffDays = () => {
    if (!form.report_date) return 0;
    const todayISTStr = getISTDateString(0);
    const rDate = new Date(`${form.report_date}T00:00:00+05:30`);
    const tDate = new Date(`${todayISTStr}T00:00:00+05:30`);
    return Math.round(
      (tDate.getTime() - rDate.getTime()) / (1000 * 60 * 60 * 24)
    );
  };

  const diffDaysDynamic = calculateDiffDays();
  const isFutureDate = !isEditMode && diffDaysDynamic < 0;
  const isBackdateLocked =
    !isEditMode && diffDaysDynamic > 7 && diffDaysDynamic <= 30;
  const isTooOld = !isEditMode && diffDaysDynamic > 30;

  // Dual-Platform Mathematical Engine
  const bsnlCbpCash = form.cbp_landline_amt + form.cbp_gsm_amt;
  const bsnlCtopCash = form.ctop_recharge_amt;
  const bsnlSimCash =
    form.sim_replacement_amt +
    form.sim_fancy_amt +
    form.sim_postpaid_amt +
    form.frc_amt +
    form.mnp_amt;
  const bsnlOtherCash = form.other_amt;

  const totalSimQty =
    form.sim_new_qty +
    form.sim_upgrade_qty +
    form.sim_postpaid_qty +
    form.sim_replacement_qty +
    form.sim_fancy_qty +
    form.frc_qty +
    form.mnp_qty;
  const paybullTotalCash =
    form.pb_cbp_amt +
    form.pb_ctop_amt +
    form.pb_frc_amt +
    form.pb_mnp_amt +
    form.pb_other_amt;
  const grandTotalCashCollection =
    bsnlCbpCash + bsnlCtopCash + bsnlSimCash + bsnlOtherCash + paybullTotalCash;

  const isZeroBusiness =
    grandTotalCashCollection === 0 &&
    totalSimQty === 0 &&
    form.cheque_amt === 0;

  // Backdate Request Engine
  const handleBackdateRequest = async () => {
    if (!partner)
      return setStatusBanner({
        type: "error",
        text: "[ERR-REL-203] Partner profile not loaded.",
      });
    setSubmitting(true);
    setStatusBanner(null);

    try {
      const { data: duplicateCheck } = await supabase
        .from("daily_sales_reports")
        .select("id")
        .eq("partner_id", partner.id)
        .eq("report_date", form.report_date)
        .maybeSingle();

      if (duplicateCheck) {
        throw {
          code: "23505",
          message: "Duplicate sales report date.",
        };
      }

      const payload = {
        partner_id: partner.id,
        center_id: partner.center_id,
        ...form,
        status: "Pending Deposit",
        edit_request_status: "Pending",
        edit_request_reason: `BACKDATE REQUEST: Permission required to log missing sales for ${formatToDDMMYYYY(
          form.report_date
        )}`,
      };

      const { data: inserted, error } = await supabase
        .from("daily_sales_reports")
        .insert([payload])
        .select()
        .maybeSingle();

      if (error) throw error;

      await logSystemTelemetry({
        actorId: partner.id,
        actorEmail: partner.email,
        module: "PARTNER_SALES_REPORT",
        actionCode: "BACKDATE_REQUESTED",
        referenceId: inserted?.id || form.report_date,
        metadata: { report_date: form.report_date },
      });

      alert(
        "✅ Backdate approval request submitted. The Back-Office will review it shortly. Once approved, you will be prompted to enter the actual sales data."
      );
      router.push("/partner/dashboard");
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_SALES_BACKDATE", {
        id: partner?.id,
        email: partner?.email,
      });
      setStatusBanner({ type: "error", text: safeMsg });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!partner)
      return setStatusBanner({
        type: "error",
        text: "[ERR-REL-203] Partner profile not loaded.",
      });
    if (isFutureDate)
      return setStatusBanner({
        type: "error",
        text: "Validation Error: You cannot log a sales report for a future date.",
      });
    if (isBackdateLocked || isTooOld)
      return setStatusBanner({
        type: "error",
        text: "[ERR-LCK-116] Cannot submit locked backdated dates without approval.",
      });
    if (!confirmSubmit)
      return setStatusBanner({
        type: "error",
        text: "Validation Error: Please check the mandatory verification box to confirm your data is accurate.",
      });

    if (isZeroBusiness && !form.zero_business_reason) {
      return setStatusBanner({
        type: "error",
        text: "Validation Error: You are attempting to submit a '0' entry. Please select a valid reason from the dropdown menu.",
      });
    }

    setSubmitting(true);
    setStatusBanner(null);
    try {
      if (!isEditMode && (diffDaysDynamic > 7 || diffDaysDynamic < 0))
        throw new Error("Date lock bypass blocked.");

      if (!isEditMode) {
        const { data: duplicateCheck } = await supabase
          .from("daily_sales_reports")
          .select("id")
          .eq("partner_id", partner.id)
          .eq("report_date", form.report_date)
          .maybeSingle();

        if (duplicateCheck) {
          throw { code: "23505", message: "Duplicate sales report date." };
        }
      }

      const finalStatus = "Pending Deposit";

      const payload = {
        partner_id: partner.id,
        center_id: partner.center_id,
        ...form,
        zero_business_reason: isZeroBusiness ? form.zero_business_reason : null,
        status: finalStatus,
      };

      if (isEditMode && editingId) {
        const { error } = await supabase
          .from("daily_sales_reports")
          .update({
            ...payload,
            edit_request_status: null,
            edit_request_reason: null,
          })
          .eq("id", editingId);
        if (error) throw error;

        await logSystemTelemetry({
          actorId: partner.id,
          actorEmail: partner.email,
          module: "PARTNER_SALES_REPORT",
          actionCode: "SALES_REPORT_CORRECTED",
          referenceId: editingId,
          metadata: {
            report_date: form.report_date,
            total_cash: grandTotalCashCollection,
            total_sims: totalSimQty,
          },
        });

        alert(
          "✅ Sales Report Corrected Successfully! The ledger has been updated."
        );
      } else {
        const { data: inserted, error } = await supabase
          .from("daily_sales_reports")
          .insert([payload])
          .select()
          .maybeSingle();
        if (error) throw error;

        await logSystemTelemetry({
          actorId: partner.id,
          actorEmail: partner.email,
          module: "PARTNER_SALES_REPORT",
          actionCode: isZeroBusiness
            ? "ZERO_SALES_SUBMITTED"
            : "DAILY_SALES_SUBMITTED",
          referenceId: inserted?.id || form.report_date,
          metadata: {
            report_date: form.report_date,
            total_cash: grandTotalCashCollection,
            total_sims: totalSimQty,
            zero_reason: isZeroBusiness ? form.zero_business_reason : null,
          },
        });

        alert(
          isZeroBusiness
            ? "✅ Zero Business Day Logged. No deposit required."
            : "✅ Sales Report Saved! Please proceed to 'Deposit of Sales' to clear your ledger."
        );
      }

      setConfirmSubmit(false);
      router.push(
        isZeroBusiness || isEditMode ? "/partner/dashboard" : "/partner/deposit"
      );
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_SALES_SUBMIT", {
        id: partner?.id,
        email: partner?.email,
      });
      setStatusBanner({ type: "error", text: safeMsg });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/partner/login");
  };

  if (loading)
    return (
      <div className="p-20 text-center font-bold text-blue-600 animate-pulse">
        Loading Daily Sales &amp; Cash Collection Portal...
      </div>
    );

  if (syncError)
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="bg-red-50 p-8 rounded-2xl shadow-sm border-2 border-red-200 max-w-lg w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-red-800 mb-3 uppercase tracking-widest">
            System Load Error
          </h2>
          <p className="text-sm font-bold text-red-900 mb-6 leading-relaxed">
            {syncError}
          </p>
          <button
            onClick={handleSignOut}
            className="bg-red-600 hover:bg-red-700 text-white font-black px-6 py-3 rounded-lg shadow transition w-full"
          >
            Sign Out &amp; Reset Session
          </button>
        </div>
      </div>
    );

  const numInputClass =
    "w-full border-2 border-slate-200 p-3 rounded-lg bg-white outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 font-black text-base text-slate-900 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  const showSection = (idx: number) =>
    mobileSection === 0 || mobileSection === idx;

  return (
    <div className="min-h-screen bg-slate-100 p-3 sm:p-6 md:p-8 pb-32 lg:pb-12 font-sans">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* TOP HEADER & QUICK ESCAPE */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <Link
              href="/partner/dashboard"
              className="text-blue-600 font-black text-xs uppercase tracking-widest mb-1 hover:underline inline-block"
            >
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
              {isEditMode
                ? "Correct Sales Report"
                : "Daily Sales & Cash Collection Entry"}
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm font-bold mt-0.5">
              Center: [{partner?.locations?.center_code || "CENTER"}]{" "}
              {partner?.locations?.center_name} &bull; Role:{" "}
              <span className="text-blue-600 uppercase">{partner?.role}</span>
            </p>
          </div>
          <Link
            href="/partner/deposit"
            className="w-full sm:w-auto text-center bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-widest px-4 py-3 rounded-xl shadow transition shrink-0"
          >
            💳 Go to Deposit Portal &rarr;
          </Link>
        </div>

        {/* LIVE COLLECTION VS DEPOSIT DEDUCTION BANNER */}
        <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-lg border border-slate-800 grid grid-cols-3 gap-2 sm:gap-4 text-center sm:text-left">
          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
            <p className="text-[9px] sm:text-[10px] font-black uppercase text-blue-400 tracking-wider">
              Cumulative Collection
            </p>
            <p className="text-sm sm:text-xl font-black text-white mt-0.5">
              ₹{ledgerSummary.totalCollected.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
            <p className="text-[9px] sm:text-[10px] font-black uppercase text-emerald-400 tracking-wider">
              Less: Total Deposited
            </p>
            <p className="text-sm sm:text-xl font-black text-emerald-400 mt-0.5">
              - ₹{ledgerSummary.totalDeposited.toLocaleString("en-IN")}
            </p>
          </div>
          <div
            className={`p-3 rounded-xl border ${
              ledgerSummary.balancePayable > 0
                ? "bg-red-950/80 border-red-500"
                : "bg-emerald-950/80 border-emerald-500"
            }`}
          >
            <p className="text-[9px] sm:text-[10px] font-black uppercase text-amber-300 tracking-wider">
              Prev Balance Payable
            </p>
            <p className="text-sm sm:text-xl font-black text-white mt-0.5">
              ₹{ledgerSummary.balancePayable.toLocaleString("en-IN")}
            </p>
          </div>
        </div>

        {statusBanner && (
          <div
            className={`p-4 rounded-xl border-2 font-bold text-xs flex justify-between items-center shadow-sm ${
              statusBanner.type === "error"
                ? "bg-red-50 border-red-300 text-red-900"
                : "bg-emerald-50 border-emerald-300 text-emerald-900"
            }`}
          >
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="font-black text-base px-2"
            >
              ✕
            </button>
          </div>
        )}

        {isEditMode && (
          <div className="bg-amber-100 border border-amber-300 p-4 rounded-xl shadow-sm animate-pulse">
            <h3 className="font-black text-amber-900 uppercase tracking-widest text-xs flex items-center gap-2">
              <span>⚠️</span> Action Required
            </h3>
            <p className="text-amber-800 text-xs sm:text-sm font-bold mt-1">
              You are editing an approved correction for{" "}
              <span className="font-black bg-white px-2 py-0.5 rounded">
                {formatToDDMMYYYY(form.report_date)}
              </span>
              . Submit this correction to unlock standard entries.
            </p>
          </div>
        )}

        {isBackdateLocked && (
          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-sm">
            <h3 className="font-black text-amber-900 uppercase tracking-widest text-xs flex items-center gap-2">
              <span>🔒</span> Ledger Locked (Backdate Mode)
            </h3>
            <p className="text-amber-800 text-xs sm:text-sm font-bold mt-1">
              The date you selected is older than 7 days. Request approval from
              Corporate Admin below to unlock data entry.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* REPORT DATE SELECTOR */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-slate-700 font-black mb-1 text-xs uppercase tracking-wider">
                Select Report Date *
              </label>
              <input
                type="date"
                required
                max={getISTDateString(0)}
                disabled={isEditMode}
                value={form.report_date}
                onChange={(e) =>
                  setForm({ ...form, report_date: e.target.value })
                }
                className="w-full border-2 border-slate-300 p-3 rounded-xl font-black text-sm outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-500"
              />
              <p className="text-[11px] text-red-600 font-bold mt-1.5">
                Reports older than 7 days require manual unlock requests.
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
                Selected Date (DD/MM/YYYY)
              </span>
              <span className="text-2xl font-black text-blue-700">
                {formatToDDMMYYYY(form.report_date)}
              </span>
            </div>
          </div>

          {/* MOBILE QUICK-TAP SECTION PILLS (VISIBLE ON PHONES / TABLETS < LG) */}
          <div className="lg:hidden bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Quick-Jump Sections (Mobile View)
              </span>
              <button
                type="button"
                onClick={() => setMobileSection(mobileSection === 0 ? 1 : 0)}
                className="text-[10px] font-black uppercase text-blue-600 underline"
              >
                {mobileSection === 0 ? "Collapse Sections" : "Expand All 5"}
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {[
                { id: 1, label: "1. CBP", amt: bsnlCbpCash },
                { id: 2, label: "2. CTOP", amt: bsnlCtopCash + form.frc_amt },
                { id: 3, label: "3. SIM", amt: bsnlSimCash - form.frc_amt },
                {
                  id: 4,
                  label: "4. Chq",
                  amt: bsnlOtherCash + form.cheque_amt,
                },
                { id: 5, label: "5. PB", amt: paybullTotalCash },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMobileSection(tab.id)}
                  className={`py-2 px-1 rounded-xl font-black text-[10px] uppercase transition border ${
                    mobileSection === tab.id || mobileSection === 0
                      ? "bg-slate-900 text-white border-slate-900 shadow"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  <span className="block truncate">{tab.label}</span>
                  <span className="block text-[9px] text-emerald-400 mt-0.5 truncate">
                    ₹{tab.amt}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* MAIN FORM GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div
              className={`lg:col-span-8 space-y-5 ${
                isBackdateLocked || isTooOld || isFutureDate
                  ? "opacity-50 pointer-events-none grayscale"
                  : ""
              }`}
            >
              {/* --- 1. BSNL CBP HEAD --- */}
              <div
                className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm ${
                  showSection(1) ? "block" : "hidden lg:block"
                }`}
              >
                <div
                  className="flex justify-between items-center border-b border-slate-200 pb-2.5 mb-4 cursor-pointer lg:cursor-default"
                  onClick={() => setMobileSection(1)}
                >
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">
                    1. BSNL CBP Head
                  </h3>
                  <span className="text-xs font-black text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                    Subtotal: ₹{bsnlCbpCash.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Landline Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.cbp_landline_qty || ""}
                      onChange={(e) =>
                        handleInputChange("cbp_landline_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Landline ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.cbp_landline_amt || ""}
                      onChange={(e) =>
                        handleInputChange("cbp_landline_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      GSM Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.cbp_gsm_qty || ""}
                      onChange={(e) =>
                        handleInputChange("cbp_gsm_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      GSM ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.cbp_gsm_amt || ""}
                      onChange={(e) =>
                        handleInputChange("cbp_gsm_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                </div>
                <div className="lg:hidden mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMobileSection(2)}
                    className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg"
                  >
                    Next: 2. CTOP &amp; FRC &rarr;
                  </button>
                </div>
              </div>

              {/* --- 2. BSNL CTOP HEAD --- */}
              <div
                className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm ${
                  showSection(2) ? "block" : "hidden lg:block"
                }`}
              >
                <div
                  className="flex justify-between items-center border-b border-slate-200 pb-2.5 mb-4 cursor-pointer lg:cursor-default"
                  onClick={() => setMobileSection(2)}
                >
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">
                    2. BSNL CTOP &amp; FRC Head
                  </h3>
                  <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    Subtotal: ₹
                    {(bsnlCtopCash + form.frc_amt).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  <div>
                    <label className="text-[11px] font-black text-blue-800 block mb-1">
                      CTOP Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.ctop_recharge_qty || ""}
                      onChange={(e) =>
                        handleInputChange("ctop_recharge_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-blue-800 block mb-1">
                      CTOP ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.ctop_recharge_amt || ""}
                      onChange={(e) =>
                        handleInputChange("ctop_recharge_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={`${numInputClass} bg-blue-50 border-blue-300 text-blue-900`}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-emerald-800 block mb-1">
                      FRC Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.frc_qty || ""}
                      onChange={(e) =>
                        handleInputChange("frc_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-emerald-800 block mb-1">
                      FRC ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.frc_amt || ""}
                      onChange={(e) =>
                        handleInputChange("frc_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={`${numInputClass} bg-emerald-50 border-emerald-300 text-emerald-900`}
                    />
                  </div>
                </div>
                <div className="lg:hidden mt-4 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setMobileSection(1)}
                    className="bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg"
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileSection(3)}
                    className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg"
                  >
                    Next: 3. SIM Tracking &rarr;
                  </button>
                </div>
              </div>

              {/* --- 3. BSNL SIM TRACKING --- */}
              <div
                className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm ${
                  showSection(3) ? "block" : "hidden lg:block"
                }`}
              >
                <div
                  className="flex justify-between items-center border-b border-slate-200 pb-2.5 mb-4 cursor-pointer lg:cursor-default"
                  onClick={() => setMobileSection(3)}
                >
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">
                    3. BSNL SIM Tracking
                  </h3>
                  <span className="text-xs font-black text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200">
                    {totalSimQty} SIMs | ₹{bsnlSimCash.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  <div>
                    <label className="text-[11px] font-black text-purple-800 block mb-1">
                      MNP Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.mnp_qty || ""}
                      onChange={(e) =>
                        handleInputChange("mnp_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-purple-800 block mb-1">
                      MNP ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.mnp_amt || ""}
                      onChange={(e) =>
                        handleInputChange("mnp_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={`${numInputClass} bg-purple-50 border-purple-300 text-purple-900`}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      New SIM Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.sim_new_qty || ""}
                      onChange={(e) =>
                        handleInputChange("sim_new_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Upgrade Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.sim_upgrade_qty || ""}
                      onChange={(e) =>
                        handleInputChange("sim_upgrade_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Postpaid Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.sim_postpaid_qty || ""}
                      onChange={(e) =>
                        handleInputChange("sim_postpaid_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Postpaid ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.sim_postpaid_amt || ""}
                      onChange={(e) =>
                        handleInputChange("sim_postpaid_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Replace Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.sim_replacement_qty || ""}
                      onChange={(e) =>
                        handleInputChange("sim_replacement_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Replace ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.sim_replacement_amt || ""}
                      onChange={(e) =>
                        handleInputChange("sim_replacement_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Fancy Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.sim_fancy_qty || ""}
                      onChange={(e) =>
                        handleInputChange("sim_fancy_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Fancy ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.sim_fancy_amt || ""}
                      onChange={(e) =>
                        handleInputChange("sim_fancy_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                </div>
                <div className="lg:hidden mt-4 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setMobileSection(2)}
                    className="bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg"
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileSection(4)}
                    className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg"
                  >
                    Next: 4. Adjustments &rarr;
                  </button>
                </div>
              </div>

              {/* --- 4. BSNL ADJUSTMENTS --- */}
              <div
                className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm ${
                  showSection(4) ? "block" : "hidden lg:block"
                }`}
              >
                <div
                  className="flex justify-between items-center border-b border-slate-200 pb-2.5 mb-4 cursor-pointer lg:cursor-default"
                  onClick={() => setMobileSection(4)}
                >
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">
                    4. Cheques &amp; Other Adjustments
                  </h3>
                  <span className="text-xs font-black text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                    Other Cash: ₹{bsnlOtherCash.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Cheque Qty
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.cheque_qty || ""}
                      onChange={(e) =>
                        handleInputChange("cheque_qty", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Total Cheque ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.cheque_amt || ""}
                      onChange={(e) =>
                        handleInputChange("cheque_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={`${numInputClass} bg-amber-50 border-amber-300 text-amber-900`}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Other Details
                    </label>
                    <input
                      type="text"
                      value={form.other_details}
                      onChange={(e) =>
                        setForm({ ...form, other_details: e.target.value })
                      }
                      placeholder="Remarks..."
                      className="w-full border-2 border-slate-200 p-3 rounded-lg bg-white outline-none focus:border-blue-600 text-sm font-bold"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-[11px] font-black text-slate-600 block mb-1">
                      Other Cash ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.other_amt || ""}
                      onChange={(e) =>
                        handleInputChange("other_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                </div>
                <div className="lg:hidden mt-4 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setMobileSection(3)}
                    className="bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg"
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileSection(5)}
                    className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg"
                  >
                    Next: 5. Paybull &rarr;
                  </button>
                </div>
              </div>

              {/* --- 5. PAYBULL PLATFORM (ISOLATED) --- */}
              <div
                className={`bg-gradient-to-br from-indigo-50 to-blue-50 p-5 sm:p-6 rounded-2xl border border-indigo-200 shadow-sm ${
                  showSection(5) ? "block" : "hidden lg:block"
                }`}
              >
                <div
                  className="flex justify-between items-center border-b border-indigo-200 pb-2.5 mb-4 cursor-pointer lg:cursor-default"
                  onClick={() => setMobileSection(5)}
                >
                  <h3 className="font-black text-indigo-950 text-sm uppercase tracking-wider flex items-center gap-2">
                    <span>💳</span> 5. Paybull Platform Sales
                  </h3>
                  <span className="text-xs font-black text-indigo-900 bg-white px-2.5 py-1 rounded-lg border border-indigo-200">
                    PB Total: ₹{paybullTotalCash.toLocaleString("en-IN")}
                  </span>
                </div>
                <p className="text-[10px] uppercase font-black text-indigo-600 tracking-widest mb-4">
                  Log transactions processed exclusively on Paybull
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
                  <div>
                    <label className="text-[10px] font-black text-indigo-900 uppercase tracking-widest block mb-1">
                      PB CTOP ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.pb_ctop_amt || ""}
                      onChange={(e) =>
                        handleInputChange("pb_ctop_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-indigo-900 uppercase tracking-widest block mb-1">
                      PB CBP ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.pb_cbp_amt || ""}
                      onChange={(e) =>
                        handleInputChange("pb_cbp_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-indigo-900 uppercase tracking-widest block mb-1">
                      PB FRC ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.pb_frc_amt || ""}
                      onChange={(e) =>
                        handleInputChange("pb_frc_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-indigo-900 uppercase tracking-widest block mb-1">
                      PB MNP ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.pb_mnp_amt || ""}
                      onChange={(e) =>
                        handleInputChange("pb_mnp_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-[10px] font-black text-indigo-900 uppercase tracking-widest block mb-1">
                      PB Other ₹
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={form.pb_other_amt || ""}
                      onChange={(e) =>
                        handleInputChange("pb_other_amt", e.target.value)
                      }
                      onWheel={handleWheel}
                      onKeyDown={handleKeyDown}
                      placeholder="0.00"
                      className={numInputClass}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: THE MASTER SUMMARY & SUBMIT CONSOLE */}
            <div id="sales-submit-console" className="lg:col-span-4">
              <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 overflow-hidden lg:sticky lg:top-8">
                <div className="bg-slate-950 p-4 border-b border-slate-800 flex justify-between items-center">
                  <h3 className="font-black text-white text-base tracking-wide uppercase">
                    Live Sales Summary
                  </h3>
                  <span className="text-[10px] font-black text-emerald-400 bg-emerald-950 px-2.5 py-1 rounded border border-emerald-800">
                    {formatToDDMMYYYY(form.report_date)}
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  {/* BSNL Breakdown */}
                  <div className="bg-slate-800 rounded-xl p-4 space-y-2.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-bold">BSNL CBP:</span>
                      <span className="text-white font-black">
                        ₹
                        {bsnlCbpCash.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-bold">
                        BSNL CTOP:
                      </span>
                      <span className="text-white font-black">
                        ₹
                        {bsnlCtopCash.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-bold">
                        BSNL SIM / FRC / MNP:
                      </span>
                      <span className="text-white font-black">
                        ₹
                        {bsnlSimCash.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    {bsnlOtherCash > 0 && (
                      <div className="flex justify-between items-center text-xs text-emerald-400">
                        <span className="font-bold">Other Cash:</span>
                        <span className="font-black">
                          ₹
                          {bsnlOtherCash.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ISOLATED PAYBULL HEAD */}
                  <div className="bg-gradient-to-br from-indigo-900 to-blue-900 p-4 rounded-xl border border-indigo-700 shadow-lg">
                    <p className="text-[10px] text-indigo-300 font-black uppercase tracking-widest mb-1 flex items-center justify-between">
                      <span>Paybull Platform Total</span>
                      <span>₹</span>
                    </p>
                    <div className="flex justify-between items-end">
                      <div className="text-[9px] text-indigo-200 font-bold max-w-[120px] leading-tight">
                        CTOP + CBP + FRC + MNP + Other
                      </div>
                      <p className="text-2xl font-black text-white">
                        ₹
                        {paybullTotalCash.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-900/40 border border-blue-800/50 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-blue-300 font-black uppercase tracking-widest">
                        Total SIM Qty
                      </p>
                      <p className="text-xl text-blue-100 font-black">
                        {totalSimQty}{" "}
                        <span className="text-xs font-medium">Qty</span>
                      </p>
                    </div>
                    <div className="bg-amber-900/40 border border-amber-800/50 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-amber-300 font-black uppercase tracking-widest">
                        Cheque Value
                      </p>
                      <p className="text-lg text-amber-100 font-black">
                        ₹{form.cheque_amt.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>

                  {/* FINAL BANK DEPOSIT */}
                  <div className="pt-4 border-t border-slate-700 text-center">
                    <p className="text-emerald-400 font-black uppercase text-[10px] tracking-widest mb-1 bg-emerald-900/30 inline-block px-3 py-1 rounded-full border border-emerald-800">
                      Total Cash To Deposit (BSNL + Paybull)
                    </p>
                    <h2 className="text-4xl font-black text-white mt-2">
                      ₹{grandTotalCashCollection.toLocaleString("en-IN")}
                    </h2>
                  </div>

                  {/* ZERO BUSINESS MENU TRIGGER */}
                  {isZeroBusiness &&
                    !isBackdateLocked &&
                    !isTooOld &&
                    !isFutureDate && (
                      <div className="mt-4 bg-amber-50 p-4 rounded-xl border-2 border-amber-400 animate-in fade-in zoom-in-95">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-amber-900 mb-2">
                          ⚠️ &apos;0&apos; Entry Detected - Select Reason *
                        </label>
                        <select
                          required
                          value={form.zero_business_reason}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              zero_business_reason: e.target.value,
                            })
                          }
                          className="w-full border-2 border-amber-300 p-3 rounded-lg text-sm font-bold bg-white text-amber-900 outline-none focus:border-amber-600"
                        >
                          <option value="" disabled>
                            -- Select Reason --
                          </option>
                          <option value="ABSENT">1. ABSENT / ON LEAVE</option>
                          <option value="NO BUSINESS">2. NO BUSINESS</option>
                          <option value="TECHNICAL ISSUES">
                            3. TECHNICAL ISSUES
                          </option>
                          <option value="OTHER REASONS">
                            4. OTHER REASONS
                          </option>
                        </select>
                      </div>
                    )}
                </div>

                <div className="p-4 bg-slate-950">
                  {isFutureDate ? (
                    <div className="bg-red-900/50 border border-red-500 p-4 rounded-xl text-center">
                      <p className="text-red-400 font-black uppercase tracking-widest text-sm">
                        Future Date Blocked
                      </p>
                      <p className="text-red-200 text-xs font-bold mt-1">
                        You cannot log a sales report for a future date.
                      </p>
                    </div>
                  ) : isTooOld ? (
                    <div className="bg-red-900/50 border border-red-500 p-4 rounded-xl text-center">
                      <p className="text-red-400 font-black uppercase tracking-widest text-sm">
                        System Blocked
                      </p>
                      <p className="text-red-200 text-xs font-bold mt-1">
                        You cannot submit or request entries older than 30 days.
                      </p>
                    </div>
                  ) : isBackdateLocked ? (
                    <button
                      type="button"
                      onClick={handleBackdateRequest}
                      disabled={submitting}
                      className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black text-base rounded-xl transition shadow-md disabled:opacity-50 uppercase tracking-wider flex justify-center items-center gap-2"
                    >
                      {submitting
                        ? "Requesting..."
                        : "🔒 Request Backdate Approval"}
                    </button>
                  ) : (
                    <>
                      <div className="bg-slate-800 p-4 border border-slate-700 rounded-xl flex items-start gap-3 mb-4 animate-in fade-in">
                        <input
                          type="checkbox"
                          id="confirmSubmit"
                          checked={confirmSubmit}
                          onChange={(e) => setConfirmSubmit(e.target.checked)}
                          className="w-5 h-5 accent-green-500 cursor-pointer mt-0.5 shrink-0"
                        />
                        <label
                          htmlFor="confirmSubmit"
                          className="text-[10px] font-bold text-slate-300 cursor-pointer flex-1 leading-relaxed uppercase tracking-wider"
                        >
                          <span className="text-white font-black block mb-0.5">
                            Mandatory Verification *
                          </span>
                          I confirm the entered sales figures are accurate and
                          verified against physical collections.
                        </label>
                      </div>

                      <button
                        type="submit"
                        disabled={
                          submitting ||
                          (isZeroBusiness && !form.zero_business_reason) ||
                          !confirmSubmit
                        }
                        className="w-full py-4 bg-green-500 hover:bg-green-600 text-slate-900 font-black text-base rounded-xl transition shadow-md disabled:bg-slate-700 disabled:text-slate-500 uppercase tracking-wider"
                      >
                        {submitting
                          ? "Saving Data..."
                          : isEditMode
                          ? "Update Sales Report"
                          : isZeroBusiness
                          ? "Submit Zero Business Day"
                          : "Submit Sales Report"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>

        <div className="flex gap-4 justify-center mt-6 pb-6">
          <Link
            href="/partner/stock"
            className="text-slate-600 font-black text-xs uppercase tracking-widest hover:text-blue-600 hover:underline"
          >
            📦 Stock Requisitions
          </Link>
          <span className="text-slate-300">|</span>
          <Link
            href="/partner/deposit"
            className="text-slate-600 font-black text-xs uppercase tracking-widest hover:text-blue-600 hover:underline"
          >
            💳 Deposit of Sales
          </Link>
        </div>
      </div>

      {/* STICKY MOBILE BOTTOM SUMMARY BAR (APP-STYLE BAR FOR OCSC SMARTPHONES) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950 text-white border-t-2 border-emerald-500 px-4 py-3 shadow-2xl">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase text-emerald-400 tracking-widest">
              Today&apos;s Cash to Deposit ({totalSimQty} SIMs)
            </p>
            <p className="text-2xl font-black text-white leading-tight">
              ₹{grandTotalCashCollection.toLocaleString("en-IN")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("sales-submit-console");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-widest px-4 py-3 rounded-xl shadow-lg shrink-0"
          >
            Verify &amp; Submit &uarr;
          </button>
        </div>
      </div>
    </div>
  );
}