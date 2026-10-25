// FILE PATH: ./app/dashboard/sales-verification/page.tsx
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

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes("/")) {
    const parts = dateStr.split("/");
    if (parts.length === 3)
      return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
        2,
        "0"
      )}`;
  }
  if (dateStr.includes("-")) {
    const dateOnly = dateStr.split("T")[0];
    const parts = dateOnly.split("-");
    if (parts[0].length === 4) return dateOnly;
    if (parts[2].length === 4)
      return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
        2,
        "0"
      )}`;
  }
  return dateStr.split("T")[0];
};

export default function StaffSalesVerification() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Active Ledger Stream Toggle (Telecom/Paybull vs Aadhaar Kendra)
  const [activeStream, setActiveStream] = useState<"telecom" | "aadhaar">(
    "telecom"
  );

  // Master Directory & Ledger Streams
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [allPartners, setAllPartners] = useState<any[]>([]);
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawAadhaar, setRawAadhaar] = useState<any[]>([]);
  const [tariffHistory, setTariffHistory] = useState<any[]>([]);
  const [latestDeposits, setLatestDeposits] = useState<Record<string, any>>({});

  // --- 7-OPTION DATE PRESET + 4-TIER CASCADING FILTER STATE ---
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

  // --- TELECOM EDIT MODAL STATE ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingSale, setEditingSale] = useState<any>(null);
  const [correctionCategory, setCorrectionCategory] = useState("");
  const [otherCorrectionText, setOtherCorrectionText] = useState("");

  // --- AADHAAR EDIT MODAL STATE ---
  const [isAadhaarEditOpen, setIsAadhaarEditOpen] = useState(false);
  const [editingAadhaar, setEditingAadhaar] = useState<any>(null);
  const [manualCashOverride, setManualCashOverride] = useState(false);
  const [aadhaarCorrectionCategory, setAadhaarCorrectionCategory] =
    useState("");
  const [aadhaarOtherText, setAadhaarOtherText] = useState("");

  const handleNumericWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleNumericKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowUp", "ArrowDown", "e", "E", "+", "-"].includes(e.key)) {
      e.preventDefault();
    }
  };

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, [fromDate, toDate]);

  const fetchAuditData = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [locRes, partRes, salesRes, aadhaarRes, depsRes, tarRes] =
        await Promise.all([
          supabase.from("locations").select("*").order("center_name"),
          supabase
            .from("active_partners")
            .select(
              "id, partner_name, role, role_aadhaar, aadhaar_operator_id, aadhaar_station_id, center_id, locations (id, state, dist, center_name, center_code, parent_master_id)"
            )
            .order("partner_name"),
          supabase
            .from("daily_sales_reports")
            .select(
              `*, active_partners ( id, partner_name, locations (id, state, dist, center_name, center_code, parent_master_id) )`
            )
            .gte("report_date", fromDate)
            .lte("report_date", toDate)
            .order("report_date", { ascending: false }),
          supabase
            .from("aadhaar_daily_reports")
            .select(
              `*, active_partners ( id, partner_name, locations (id, state, dist, center_name, center_code, parent_master_id) )`
            )
            .gte("report_date", fromDate)
            .lte("report_date", toDate)
            .order("report_date", { ascending: false }),
          supabase
            .from("partner_deposits")
            .select(
              "partner_id, status, deposit_date, created_at, deposit_amount, reference_no, deposit_stream"
            )
            .order("deposit_date", { ascending: false }),
          supabase
            .from("aadhaar_tariff_history")
            .select("*")
            .order("effective_from", { ascending: false }),
        ]);

      if (salesRes.error) throw salesRes.error;

      setAllLocations(locRes.data || []);
      setAllPartners(partRes.data || []);
      setRawSales(salesRes.data || []);
      setRawAadhaar(aadhaarRes.data || []);
      setTariffHistory(tarRes.data || []);

      const depMap: Record<string, any> = {};
      (depsRes.data || []).forEach((d) => {
        if (!depMap[d.partner_id]) {
          depMap[d.partner_id] = d;
        }
      });
      setLatestDeposits(depMap);
    } catch (err: any) {
      console.error("Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // 4-TIER CASCADING FILTER OPTIONS (STATE -> MASTER HQ -> LOCATION -> OPERATOR)
  // =========================================================================
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

  const matchesCascade = (row: any) => {
    const p = row.active_partners;
    const locData = p?.locations;
    const l: any = Array.isArray(locData) ? locData[0] : locData;

    if (fState !== "ALL" && l?.state !== fState) return false;
    if (fHq !== "ALL" && l?.parent_master_id?.toString() !== fHq) return false;
    if (
      fCenter !== "ALL" &&
      l?.id?.toString() !== fCenter &&
      row.center_id?.toString() !== fCenter
    )
      return false;
    if (
      fPartner !== "ALL" &&
      row.partner_id !== fPartner &&
      p?.id !== fPartner
    )
      return false;
    return true;
  };

  const filteredSales = useMemo(
    () => rawSales.filter(matchesCascade),
    [rawSales, fState, fHq, fCenter, fPartner]
  );
  const filteredAadhaar = useMemo(
    () => rawAadhaar.filter(matchesCascade),
    [rawAadhaar, fState, fHq, fCenter, fPartner]
  );

  // =========================================================================
  // TELECOM & PAYBULL SALES EDIT / AUDIT HANDLERS
  // =========================================================================
  const openEditModal = (sale: any) => {
    setEditingSale({
      ...sale,
      frc_qty: sale.frc_qty || 0,
      frc_amt: sale.frc_amt || 0,
      mnp_qty: sale.mnp_qty || 0,
      mnp_amt: sale.mnp_amt || 0,
      pb_cbp_amt: sale.pb_cbp_amt || 0,
      pb_ctop_amt: sale.pb_ctop_amt || 0,
      pb_frc_amt: sale.pb_frc_amt || 0,
      pb_mnp_amt: sale.pb_mnp_amt || 0,
      pb_other_amt: sale.pb_other_amt || 0,
    });
    setCorrectionCategory("");
    setOtherCorrectionText("");
    setIsEditModalOpen(true);
  };

  const handleEditInputChange = (field: string, value: string) => {
    const isQtyField = field.includes("qty");
    const num = isQtyField ? parseInt(value, 10) : parseFloat(value);
    setEditingSale((prev: any) => ({
      ...prev,
      [field]: isNaN(num) || num < 0 ? 0 : num,
    }));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionCategory)
      return alert("You must select a Correction Reason from the dropdown.");
    if (
      correctionCategory === "Other" &&
      otherCorrectionText.trim().length < 5
    ) {
      return alert(
        "You must provide detailed remarks for 'Other' corrections."
      );
    }

    if (
      !confirm(
        "Are you sure you want to forcefully overwrite this partner's sales ledger? This action will be permanently logged."
      )
    )
      return;

    setIsSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) throw new Error("Staff authentication failed. Session lost.");

      const finalRemarks =
        correctionCategory === "Other"
          ? `OTHER: ${otherCorrectionText}`
          : `CORRECTION: ${correctionCategory}`;

      const updatePayload = {
        cbp_landline_qty: editingSale.cbp_landline_qty,
        cbp_landline_amt: editingSale.cbp_landline_amt,
        cbp_gsm_qty: editingSale.cbp_gsm_qty,
        cbp_gsm_amt: editingSale.cbp_gsm_amt,
        ctop_recharge_qty: editingSale.ctop_recharge_qty,
        ctop_recharge_amt: editingSale.ctop_recharge_amt,
        frc_qty: editingSale.frc_qty,
        frc_amt: editingSale.frc_amt,
        mnp_qty: editingSale.mnp_qty,
        mnp_amt: editingSale.mnp_amt,
        sim_new_qty: editingSale.sim_new_qty,
        sim_upgrade_qty: editingSale.sim_upgrade_qty,
        sim_postpaid_qty: editingSale.sim_postpaid_qty,
        sim_postpaid_amt: editingSale.sim_postpaid_amt,
        sim_replacement_qty: editingSale.sim_replacement_qty,
        sim_replacement_amt: editingSale.sim_replacement_amt,
        sim_fancy_qty: editingSale.sim_fancy_qty,
        sim_fancy_amt: editingSale.sim_fancy_amt,
        cheque_qty: editingSale.cheque_qty,
        cheque_amt: editingSale.cheque_amt,
        other_amt: editingSale.other_amt,
        other_details: editingSale.other_details,
        pb_cbp_amt: editingSale.pb_cbp_amt,
        pb_ctop_amt: editingSale.pb_ctop_amt,
        pb_frc_amt: editingSale.pb_frc_amt,
        pb_mnp_amt: editingSale.pb_mnp_amt,
        pb_other_amt: editingSale.pb_other_amt,
        is_edited_by_staff: true,
        staff_edit_remarks: finalRemarks,
        edited_at: new Date().toISOString(),
        edited_by: user.id,
        edit_request_status: null,
        edit_request_reason: null,
      };

      const { error } = await supabase
        .from("daily_sales_reports")
        .update(updatePayload)
        .eq("id", editingSale.id);
      if (error) throw error;

      await supabase.from("staff_activity_logs").insert([
        {
          staff_id: user.id,
          staff_email: user.email,
          action_type: "AUDIT",
          module: "SALES",
          target_id: editingSale.id,
          details: `Overwrote Telecom/Paybull sales report for ${formatToDDMMYYYY(
            editingSale.report_date
          )}. Reason: ${finalRemarks}`,
        },
      ]);

      await supabase.from("partner_messages").insert([
        {
          partner_id: editingSale.partner_id,
          subject: `⚠ Financial Ledger Correction: ${formatToDDMMYYYY(
            editingSale.report_date
          )}`,
          body: `Your sales report for ${formatToDDMMYYYY(
            editingSale.report_date
          )} was audited and corrected by the Back-Office. Reason: ${finalRemarks}. Please check your updated ledger balance.`,
        },
      ]);

      alert("✅ Sales Ledger Successfully Overwritten.");
      setIsEditModalOpen(false);
      fetchAuditData();
    } catch (err: any) {
      alert("System Error: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePermitEdit = async (
    saleId: string,
    action: "Approved" | "Rejected"
  ) => {
    if (!confirm(`Are you sure you want to mark this request as ${action}?`))
      return;
    try {
      const { error } = await supabase
        .from("daily_sales_reports")
        .update({ edit_request_status: action })
        .eq("id", saleId);
      if (error) throw error;
      fetchAuditData();
    } catch (err: any) {
      alert("Error processing edit request: " + err.message);
    }
  };

  // =========================================================================
  // AADHAAR KENDRA DAILY REPORT EDIT / AUDIT HANDLERS
  // =========================================================================
  const getTariffForDate = (reportDate: string) => {
    const matched = tariffHistory.find(
      (t) =>
        t.effective_from <= reportDate &&
        (!t.effective_to || t.effective_to >= reportDate)
    );
    return (
      matched || {
        mbu_chargeable_fee: 125,
        demographic_fee: 75,
        biometric_fee: 125,
        gst_percent: 18,
      }
    );
  };

  const openAadhaarEditModal = (rec: any) => {
    setEditingAadhaar({
      ...rec,
      original_cash: Number(rec.total_cash_collected || 0),
      cat1_new_qty: Number(rec.cat1_new_qty || 0),
      cat2_mbu_free_qty: Number(rec.cat2_mbu_free_qty || 0),
      cat3_mbu_chargeable_qty: Number(rec.cat3_mbu_chargeable_qty || 0),
      cat4_demographic_qty: Number(rec.cat4_demographic_qty || 0),
      cat5_biometric_qty: Number(rec.cat5_biometric_qty || 0),
      completed_qty: Number(rec.completed_qty || 0),
      inprocess_qty: Number(rec.inprocess_qty || 0),
      rejected_qty: Number(rec.rejected_qty || 0),
      total_cash_collected: Number(rec.total_cash_collected || 0),
      operator_id: rec.operator_id || "",
      station_id: rec.station_id || "",
      exemption_reason: rec.exemption_reason || "",
      deposit_status: rec.deposit_status || "Pending Deposit",
    });
    setManualCashOverride(false);
    setAadhaarCorrectionCategory("");
    setAadhaarOtherText("");
    setIsAadhaarEditOpen(true);
  };

  const handleDismissAadhaarRequest = async (rec: any) => {
    if (
      !confirm(
        `Dismiss the partner's correction request for ${formatToDDMMYYYY(
          rec.report_date
        )} without modifying the report?`
      )
    )
      return;
    try {
      const { error } = await supabase
        .from("aadhaar_daily_reports")
        .update({
          edit_request_status: "Rejected",
          edit_request_reason: null,
        })
        .eq("id", rec.id);
      if (error) throw error;
      fetchAuditData();
    } catch (err: any) {
      alert("Error dismissing Aadhaar edit request: " + err.message);
    }
  };

  const handleAadhaarQtyChange = (field: string, val: string) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setEditingAadhaar((prev: any) => {
      const next = { ...prev, [field]: num };
      if (!manualCashOverride) {
        const tariff = getTariffForDate(next.report_date);
        const calcCash =
          Number(next.cat3_mbu_chargeable_qty || 0) *
            Number(tariff.mbu_chargeable_fee || 125) +
          Number(next.cat4_demographic_qty || 0) *
            Number(tariff.demographic_fee || 75) +
          Number(next.cat5_biometric_qty || 0) *
            Number(tariff.biometric_fee || 125);
        next.total_cash_collected = calcCash;

        // Auto-adjust deposit_status when transitioning between ₹0 and > ₹0 without a linked deposit
        if (calcCash === 0) {
          next.deposit_status = "Settled";
        } else if (
          calcCash > 0 &&
          !next.deposit_id &&
          next.deposit_status === "Settled"
        ) {
          next.deposit_status = "Pending Deposit";
        }
      }
      return next;
    });
  };

  const handleAadhaarEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aadhaarCorrectionCategory)
      return alert(
        "You must select an Aadhaar Correction Reason from the dropdown."
      );
    if (
      aadhaarCorrectionCategory === "Other" &&
      aadhaarOtherText.trim().length < 5
    ) {
      return alert(
        "You must provide detailed remarks for 'Other' corrections."
      );
    }
    if (
      !confirm(
        "Are you sure you want to overwrite this partner's Aadhaar Daily Report? This action will be permanently logged."
      )
    )
      return;

    setIsSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Staff authentication failed.");

      const finalRemarks =
        aadhaarCorrectionCategory === "Other"
          ? `OTHER: ${aadhaarOtherText}`
          : `CORRECTION: ${aadhaarCorrectionCategory}`;

      const tariff = getTariffForDate(editingAadhaar.report_date);
      const totalPackets =
        Number(editingAadhaar.cat1_new_qty || 0) +
        Number(editingAadhaar.cat2_mbu_free_qty || 0) +
        Number(editingAadhaar.cat3_mbu_chargeable_qty || 0) +
        Number(editingAadhaar.cat4_demographic_qty || 0) +
        Number(editingAadhaar.cat5_biometric_qty || 0);

      const finalCash = Number(editingAadhaar.total_cash_collected || 0);
      const gstPct = Number(tariff.gst_percent || 18);
      const finalBase = Number((finalCash / (1 + gstPct / 100)).toFixed(2));
      const finalGst = Number((finalCash - finalBase).toFixed(2));

      // Automatically reset deposit_status to "Pending Deposit" if a zero-cash settled report was increased to > ₹0 without a deposit_id
      const resolvedDepositStatus =
        finalCash === 0
          ? "Settled"
          : finalCash > 0 &&
            !editingAadhaar.deposit_id &&
            editingAadhaar.deposit_status === "Settled" &&
            Number(editingAadhaar.original_cash || 0) === 0
          ? "Pending Deposit"
          : editingAadhaar.deposit_status;

      const baseUpdatePayload: any = {
        operator_id: editingAadhaar.operator_id.trim().toUpperCase(),
        station_id: editingAadhaar.station_id.trim(),
        cat1_new_qty: Number(editingAadhaar.cat1_new_qty || 0),
        cat2_mbu_free_qty: Number(editingAadhaar.cat2_mbu_free_qty || 0),
        cat3_mbu_chargeable_qty: Number(
          editingAadhaar.cat3_mbu_chargeable_qty || 0
        ),
        cat4_demographic_qty: Number(editingAadhaar.cat4_demographic_qty || 0),
        cat5_biometric_qty: Number(editingAadhaar.cat5_biometric_qty || 0),
        total_packets_qty: totalPackets,
        completed_qty: Number(editingAadhaar.completed_qty || 0),
        inprocess_qty: Number(editingAadhaar.inprocess_qty || 0),
        rejected_qty: Number(editingAadhaar.rejected_qty || 0),
        base_amount: finalBase,
        gst_amount: finalGst,
        total_cash_collected: finalCash,
        exemption_reason: editingAadhaar.exemption_reason || finalRemarks,
        deposit_status: resolvedDepositStatus,
        edit_request_status: null,
        edit_request_reason: null,
      };

      // Try updating with audit columns first; fallback cleanly if optional columns aren't added yet
      const { error: richErr } = await supabase
        .from("aadhaar_daily_reports")
        .update({
          ...baseUpdatePayload,
          is_edited_by_staff: true,
          staff_edit_remarks: finalRemarks,
          edited_at: new Date().toISOString(),
          edited_by: user.id,
        })
        .eq("id", editingAadhaar.id);

      if (richErr) {
        const { error: fallbackErr } = await supabase
          .from("aadhaar_daily_reports")
          .update(baseUpdatePayload)
          .eq("id", editingAadhaar.id);
        if (fallbackErr) throw fallbackErr;
      }

      await supabase.from("staff_activity_logs").insert([
        {
          staff_id: user.id,
          staff_email: user.email,
          action_type: "AUDIT",
          module: "AADHAAR_HUB",
          target_id: editingAadhaar.id,
          details: `Overwrote Aadhaar report for ${formatToDDMMYYYY(
            editingAadhaar.report_date
          )} (Packets: ${totalPackets}, Cash: ₹${finalCash}, Status: ${resolvedDepositStatus}). Reason: ${finalRemarks}`,
        },
      ]);

      await supabase.from("partner_messages").insert([
        {
          partner_id: editingAadhaar.partner_id,
          subject: `🆔 Aadhaar Ledger Correction: ${formatToDDMMYYYY(
            editingAadhaar.report_date
          )}`,
          body: `Your Aadhaar Daily Report for ${formatToDDMMYYYY(
            editingAadhaar.report_date
          )} was audited and updated by the Back-Office (Total Packets: ${totalPackets}, Cash Collected: ₹${finalCash.toLocaleString(
            "en-IN"
          )}, Status: ${resolvedDepositStatus}). Reason: ${finalRemarks}.`,
        },
      ]);

      alert("✅ Aadhaar Daily Report Successfully Overwritten.");
      setIsAadhaarEditOpen(false);
      fetchAuditData();
    } catch (err: any) {
      alert("Error updating Aadhaar report: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadVaultFile = async (path: string | null) => {
    if (!path) return alert("No file attached (Manual / Exemption record).");
    const { data, error } = await supabase.storage
      .from("aadhaar-reports")
      .createSignedUrl(path, 120);
    if (error || !data?.signedUrl)
      return alert("Failed to generate secure download link.");
    window.open(data.signedUrl, "_blank");
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin"></div>
      </div>
    );

  const numInputClass =
    "w-full border border-slate-300 p-2 text-sm rounded bg-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 font-bold text-slate-800 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* HEADER & DUAL-STREAM SWITCHER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-6 gap-4">
          <div>
            <Link
              href="/dashboard"
              className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-block"
            >
              &larr; Back to Admin Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">⚖️</span> Sales &amp; Aadhaar Audit
              Correction Hub
            </h1>
            <p className="text-slate-500 font-medium mt-1">
              Review raw Telecom, Paybull, and Aadhaar Kendra reports and
              enforce audited ledger corrections ({formatToDDMMYYYY(fromDate)}{" "}
              to {formatToDDMMYYYY(toDate)}).
            </p>
          </div>

          <div className="flex bg-slate-200 p-1.5 rounded-xl border border-slate-300 shadow-inner">
            <button
              onClick={() => setActiveStream("telecom")}
              className={`px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition ${
                activeStream === "telecom"
                  ? "bg-slate-900 text-white shadow-md"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              📡 Telecom &amp; Paybull ({filteredSales.length})
            </button>
            <button
              onClick={() => setActiveStream("aadhaar")}
              className={`px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition ${
                activeStream === "aadhaar"
                  ? "bg-amber-500 text-slate-950 shadow-md"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              🆔 Aadhaar Kendra ({filteredAadhaar.length})
            </button>
          </div>
        </div>

        {/* MASTER 4-TIER CASCADING FILTER + 7-OPTION DATE PRESET CONSOLE */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          {/* ROW 1: 4-TIER GEOGRAPHIC & OPERATOR CASCADE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                1. State Filter
              </label>
              <select
                value={fState}
                onChange={(e) => {
                  setFState(e.target.value);
                  setFHq("ALL");
                  setFCenter("ALL");
                  setFPartner("ALL");
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
                2. Master HQ Filter
              </label>
              <select
                value={fHq}
                onChange={(e) => {
                  setFHq(e.target.value);
                  setFCenter("ALL");
                  setFPartner("ALL");
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
                3. Location / Center [Code]
              </label>
              <select
                value={fCenter}
                onChange={(e) => {
                  setFCenter(e.target.value);
                  setFPartner("ALL");
                }}
                className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
              >
                <option value="ALL">All Locations</option>
                {locationOptions.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    [{loc.center_code || "NO-CODE"}] {loc.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                4. Operator / Partner
              </label>
              <select
                value={fPartner}
                onChange={(e) => setFPartner(e.target.value)}
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

          {/* ROW 2: 7-OPTION DATE PRESET DROPDOWN + CUSTOM DATES (DD/MM/YYYY) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
            <div>
              <label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">
                5. Date Range Preset
              </label>
              <select
                value={datePreset}
                onChange={(e) =>
                  handlePresetChange(e.target.value as DatePresetMode)
                }
                className="w-full bg-indigo-50 border-2 border-indigo-200 text-indigo-950 font-black text-xs rounded-lg p-2.5 outline-none focus:border-indigo-600"
              >
                <option value="today">
                  1. Today (
                  {formatToDDMMYYYY(getDateRangeFromPreset("today").start)})
                </option>
                <option value="yesterday">
                  2. Yesterday (
                  {formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})
                </option>
                <option value="current_week">3. Current Week</option>
                <option value="current_month">4. Current Month</option>
                <option value="previous_month">5. Previous Month</option>
                <option value="all">6. All Time</option>
                <option value="custom">7. Custom Filter</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                From Date ({formatToDDMMYYYY(fromDate)})
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setFromDate(e.target.value);
                }}
                className="w-full bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2 outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                To Date ({formatToDDMMYYYY(toDate)})
              </label>
              <input
                type="date"
                value={toDate}
                max={getISTDateString(0)}
                onChange={(e) => {
                  setDatePreset("custom");
                  setToDate(e.target.value);
                }}
                className="w-full bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-2 outline-none focus:border-amber-500"
              />
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* TAB 1: TELECOM & PAYBULL SALES LEDGER                                 */}
        {/* ===================================================================== */}
        {activeStream === "telecom" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
              <h3 className="font-black tracking-widest uppercase text-xs">
                Telecom &amp; Paybull Sales Reports Ledger
              </h3>
              <span className="bg-slate-800 text-amber-400 font-black px-3 py-1 rounded text-[10px] uppercase tracking-widest border border-slate-700">
                {filteredSales.length} Records Found
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-4 font-black">Report Date</th>
                    <th className="p-4 font-black">
                      Center [Code] &amp; Partner
                    </th>
                    <th className="p-4 font-black text-right">
                      Total Sales Amt (₹)
                    </th>
                    <th className="p-4 font-black text-center">
                      Status of Deposit
                    </th>
                    <th className="p-4 font-black text-center">Audit Status</th>
                    <th className="p-4 font-black text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-12 text-center text-slate-400 font-bold"
                      >
                        No Telecom/Paybull sales records match the current
                        cascading filters.
                      </td>
                    </tr>
                  ) : (
                    filteredSales.map((sale) => {
                      const totalCash =
                        Number(sale.cbp_landline_amt || 0) +
                        Number(sale.cbp_gsm_amt || 0) +
                        Number(sale.ctop_recharge_amt || 0) +
                        Number(sale.sim_replacement_amt || 0) +
                        Number(sale.sim_fancy_amt || 0) +
                        Number(sale.sim_postpaid_amt || 0) +
                        Number(sale.other_amt || 0) +
                        Number(sale.frc_amt || 0) +
                        Number(sale.mnp_amt || 0) +
                        Number(sale.pb_cbp_amt || 0) +
                        Number(sale.pb_ctop_amt || 0) +
                        Number(sale.pb_frc_amt || 0) +
                        Number(sale.pb_mnp_amt || 0) +
                        Number(sale.pb_other_amt || 0);

                      const lDep = latestDeposits[sale.partner_id];
                      const locData = sale.active_partners?.locations;
                      const loc: any = Array.isArray(locData)
                        ? locData[0]
                        : locData;

                      return (
                        <tr
                          key={sale.id}
                          className={`hover:bg-slate-50 transition ${
                            sale.edit_request_status === "Pending"
                              ? "bg-amber-50/30"
                              : ""
                          }`}
                        >
                          <td className="p-4">
                            <p className="font-black text-slate-900 text-lg">
                              {formatToDDMMYYYY(
                                normalizeToYYYYMMDD(sale.report_date)
                              )}
                            </p>
                            {sale.zero_business_reason && (
                              <span className="text-[9px] bg-red-100 text-red-700 font-black uppercase tracking-widest px-2 py-0.5 rounded border border-red-200 mt-1 inline-block">
                                Zero Biz: {sale.zero_business_reason}
                              </span>
                            )}
                          </td>

                          <td className="p-4">
                            <p className="font-black text-blue-700">
                              {sale.active_partners?.partner_name}
                            </p>
                            <p className="text-xs font-bold text-slate-600">
                              [{loc?.center_code || "NO-CODE"}]{" "}
                              {loc?.center_name}
                            </p>
                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">
                              {loc?.dist}, {loc?.state}
                            </p>
                          </td>

                          <td className="p-4 text-right">
                            <p className="text-xl font-black text-emerald-600">
                              ₹{totalCash.toLocaleString("en-IN")}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase mt-0.5">
                              Gross Revenue
                            </p>
                          </td>

                          <td className="p-4 text-center">
                            {lDep ? (
                              <div className="flex flex-col items-center">
                                <span
                                  className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                                    lDep.status === "Verified"
                                      ? "bg-green-100 text-green-700 border-green-200"
                                      : lDep.status === "Discrepancy"
                                      ? "bg-red-100 text-red-700 border-red-200"
                                      : "bg-amber-100 text-amber-700 border-amber-200"
                                  }`}
                                >
                                  Latest: {lDep.status}
                                </span>
                                <p className="text-[9px] text-slate-400 font-bold mt-1">
                                  Vol: ₹
                                  {Number(lDep.deposit_amount).toLocaleString(
                                    "en-IN"
                                  )}
                                </p>
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400 uppercase">
                                No Deposits Yet
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-center">
                            {sale.edit_request_status === "Pending" ? (
                              <div className="flex flex-col gap-1 items-center">
                                <span className="text-[10px] font-black uppercase bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-1 rounded shadow-sm animate-pulse">
                                  Partner Requests Edit
                                </span>
                                {sale.edit_request_reason && (
                                  <span
                                    className="text-[9px] font-bold text-amber-900 max-w-[190px] truncate"
                                    title={sale.edit_request_reason}
                                  >
                                    {sale.edit_request_reason}
                                  </span>
                                )}
                                <div className="flex gap-1 mt-1">
                                  <button
                                    onClick={() =>
                                      handlePermitEdit(sale.id, "Approved")
                                    }
                                    className="bg-green-500 text-white text-[9px] font-black uppercase px-2 py-1 rounded shadow-sm hover:bg-green-600"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() =>
                                      handlePermitEdit(sale.id, "Rejected")
                                    }
                                    className="bg-red-500 text-white text-[9px] font-black uppercase px-2 py-1 rounded shadow-sm hover:bg-red-600"
                                  >
                                    Deny
                                  </button>
                                </div>
                              </div>
                            ) : sale.is_edited_by_staff ? (
                              <div className="flex flex-col items-center">
                                <span className="text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-1 rounded shadow-sm">
                                  Overwritten by Admin
                                </span>
                                {sale.staff_edit_remarks && (
                                  <span
                                    className="text-[9px] font-bold text-slate-500 mt-1 max-w-[160px] truncate"
                                    title={sale.staff_edit_remarks}
                                  >
                                    {sale.staff_edit_remarks}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] font-black uppercase text-slate-400">
                                Original Data
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-right">
                            <button
                              onClick={() => openEditModal(sale)}
                              className="bg-slate-900 hover:bg-amber-500 hover:text-slate-900 text-white font-black px-4 py-2 rounded-lg text-xs uppercase tracking-widest transition shadow-sm border border-slate-700 flex items-center gap-2 ml-auto"
                            >
                              <span>⚙️</span> Edit / Audit
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
        )}

        {/* ===================================================================== */}
        {/* TAB 2: AADHAAR KENDRA DAILY REPORTS LEDGER & AUDIT                    */}
        {/* ===================================================================== */}
        {activeStream === "aadhaar" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
              <h3 className="font-black tracking-widest uppercase text-xs text-amber-400">
                🆔 Aadhaar Kendra Daily Reports Ledger
              </h3>
              <span className="bg-slate-800 text-amber-400 font-black px-3 py-1 rounded text-[10px] uppercase tracking-widest border border-slate-700">
                {filteredAadhaar.length} Records Found
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-4 font-black">Report Date</th>
                    <th className="p-4 font-black">
                      Center [Code] &amp; Operator
                    </th>
                    <th className="p-4 font-black text-center">New</th>
                    <th className="p-4 font-black text-center">MBU(F)</th>
                    <th className="p-4 font-black text-center">MBU(P)</th>
                    <th className="p-4 font-black text-center">Demo</th>
                    <th className="p-4 font-black text-center">Bio</th>
                    <th className="p-4 font-black text-center">Total Pkts</th>
                    <th className="p-4 font-black text-right">Cash (₹)</th>
                    <th className="p-4 font-black text-center">Vault Files</th>
                    <th className="p-4 font-black text-center">Audit Status</th>
                    <th className="p-4 font-black text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAadhaar.length === 0 ? (
                    <tr>
                      <td
                        colSpan={12}
                        className="p-12 text-center text-slate-400 font-bold"
                      >
                        No Aadhaar Kendra daily reports match the current
                        cascading filters.
                      </td>
                    </tr>
                  ) : (
                    filteredAadhaar.map((rec) => {
                      const locData = rec.active_partners?.locations;
                      const loc: any = Array.isArray(locData)
                        ? locData[0]
                        : locData;

                      return (
                        <tr
                          key={rec.id}
                          className={`hover:bg-slate-50 transition ${
                            rec.edit_request_status === "Pending"
                              ? "bg-amber-50/40"
                              : ""
                          }`}
                        >
                          <td className="p-4">
                            <p className="font-black text-slate-900 text-sm">
                              {formatToDDMMYYYY(
                                normalizeToYYYYMMDD(rec.report_date)
                              )}
                            </p>
                            <span
                              className={`text-[9px] font-black uppercase px-2 py-0.5 rounded mt-1 inline-block ${
                                rec.deposit_status === "Pending Deposit"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {rec.deposit_status}
                            </span>
                          </td>

                          <td className="p-4">
                            <p className="font-black text-blue-700">
                              {rec.active_partners?.partner_name}
                            </p>
                            <p className="text-[11px] font-bold text-slate-600">
                              [{loc?.center_code || "NO-CODE"}]{" "}
                              {loc?.center_name}
                            </p>
                            <p className="text-[10px] text-amber-800 font-black uppercase mt-0.5">
                              Op: {rec.operator_id} | Stn: {rec.station_id}
                            </p>
                          </td>

                          <td className="p-4 text-center font-bold">
                            {rec.cat1_new_qty}
                          </td>
                          <td className="p-4 text-center font-bold">
                            {rec.cat2_mbu_free_qty}
                          </td>
                          <td className="p-4 text-center font-bold text-amber-700">
                            {rec.cat3_mbu_chargeable_qty}
                          </td>
                          <td className="p-4 text-center font-bold text-blue-700">
                            {rec.cat4_demographic_qty}
                          </td>
                          <td className="p-4 text-center font-bold text-purple-700">
                            {rec.cat5_biometric_qty}
                          </td>
                          <td className="p-4 text-center font-black text-sm">
                            {rec.total_packets_qty}
                          </td>

                          <td className="p-4 text-right">
                            <p className="text-base font-black text-emerald-600">
                              ₹
                              {Number(
                                rec.total_cash_collected || 0
                              ).toLocaleString("en-IN")}
                            </p>
                            <p className="text-[9px] text-slate-400 font-bold">
                              Base: ₹{rec.base_amount} | GST: ₹{rec.gst_amount}
                            </p>
                          </td>

                          <td className="p-4 text-center">
                            {rec.has_files ? (
                              <div className="flex justify-center gap-1">
                                <button
                                  onClick={() =>
                                    handleDownloadVaultFile(rec.csv_file_url)
                                  }
                                  className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                                >
                                  CSV
                                </button>
                                <button
                                  onClick={() =>
                                    handleDownloadVaultFile(rec.html_file_url)
                                  }
                                  className="bg-indigo-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                                >
                                  HTML
                                </button>
                              </div>
                            ) : (
                              <span className="text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-black uppercase">
                                Manual ({rec.exemption_reason || "N/A"})
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-center">
                            {rec.edit_request_status === "Pending" ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-[9px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded animate-pulse">
                                  ⏳ Correction Requested
                                </span>
                                {rec.edit_request_reason && (
                                  <span
                                    className="text-[9px] font-bold text-slate-600 max-w-[160px] truncate"
                                    title={rec.edit_request_reason}
                                  >
                                    {rec.edit_request_reason}
                                  </span>
                                )}
                                <div className="flex gap-1 mt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => openAadhaarEditModal(rec)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded shadow-sm"
                                  >
                                    Audit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDismissAadhaarRequest(rec)
                                    }
                                    className="bg-red-500 hover:bg-red-600 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded shadow-sm"
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </div>
                            ) : rec.is_edited_by_staff ||
                              String(rec.exemption_reason || "").startsWith(
                                "CORRECTION:"
                              ) ||
                              String(rec.exemption_reason || "").startsWith(
                                "OTHER:"
                              ) ? (
                              <div className="flex flex-col items-center">
                                <span className="text-[9px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-0.5 rounded">
                                  Overwritten by Admin
                                </span>
                                <span
                                  className="text-[9px] font-bold text-slate-500 mt-1 max-w-[140px] truncate"
                                  title={
                                    rec.staff_edit_remarks ||
                                    rec.exemption_reason
                                  }
                                >
                                  {rec.staff_edit_remarks ||
                                    rec.exemption_reason}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] font-black uppercase text-slate-400">
                                Original
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-right">
                            <button
                              onClick={() => openAadhaarEditModal(rec)}
                              className="bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white font-black px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest transition shadow-sm flex items-center gap-1.5 ml-auto"
                            >
                              <span>⚙️</span> Edit / Audit
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
        )}
      </div>

      {/* ===================================================================== */}
      {/* MODAL 1: TELECOM & PAYBULL FORCE CORRECTION MODAL (GOD MODE)          */}
      {/* ===================================================================== */}
      {isEditModalOpen && editingSale && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-50 rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl my-8 animate-in fade-in zoom-in-95">
            <div className="p-5 bg-slate-900 flex justify-between items-center text-white rounded-t-2xl border-b-4 border-amber-500">
              <div>
                <h3 className="font-black text-xl flex items-center gap-2">
                  <span>⚠️</span> Force Correction (Telecom / Paybull):{" "}
                  {editingSale.active_partners?.partner_name}
                </h3>
                <p className="text-slate-400 text-xs font-bold tracking-widest uppercase mt-1">
                  Target Ledger Date:{" "}
                  {formatToDDMMYYYY(
                    normalizeToYYYYMMDD(editingSale.report_date)
                  )}
                </p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="hover:text-amber-500 text-3xl font-black transition"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 md:p-8 space-y-6">
              <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r shadow-sm">
                <p className="text-sm font-black text-amber-900">
                  WARNING: You are about to permanently alter a franchise&apos;s
                  daily ledger.
                </p>
                <p className="text-xs font-bold text-amber-700 mt-1">
                  This action cannot be undone. An alert will be dispatched to
                  the partner immediately.
                </p>
              </div>

              {/* DYNAMIC TOTALS HEADER */}
              <div className="bg-white p-4 rounded-xl border-2 border-slate-200 shadow-sm flex flex-wrap gap-4 justify-between items-center">
                <h4 className="font-black text-slate-800 text-sm uppercase tracking-widest">
                  Live Audit Totals:
                </h4>
                <div className="flex flex-wrap gap-4">
                  <div className="text-center bg-slate-50 p-2 rounded border border-slate-200 min-w-[100px]">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                      BSNL CBP / CTOP
                    </p>
                    <p className="font-black text-lg text-slate-800">
                      ₹
                      {(
                        Number(editingSale.cbp_landline_amt) +
                        Number(editingSale.cbp_gsm_amt) +
                        Number(editingSale.ctop_recharge_amt)
                      ).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="text-center bg-slate-50 p-2 rounded border border-slate-200 min-w-[100px]">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                      BSNL SIM / Other
                    </p>
                    <p className="font-black text-lg text-slate-800">
                      ₹
                      {(
                        Number(editingSale.sim_replacement_amt) +
                        Number(editingSale.sim_fancy_amt) +
                        Number(editingSale.sim_postpaid_amt) +
                        Number(editingSale.other_amt) +
                        Number(editingSale.frc_amt) +
                        Number(editingSale.mnp_amt)
                      ).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="text-center bg-indigo-50 p-2 rounded border border-indigo-200 min-w-[100px]">
                    <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">
                      Paybull Cash
                    </p>
                    <p className="font-black text-lg text-indigo-800">
                      ₹
                      {(
                        Number(editingSale.pb_cbp_amt) +
                        Number(editingSale.pb_ctop_amt) +
                        Number(editingSale.pb_frc_amt) +
                        Number(editingSale.pb_mnp_amt) +
                        Number(editingSale.pb_other_amt)
                      ).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="text-center bg-emerald-50 border border-emerald-200 p-2 rounded min-w-[120px]">
                    <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">
                      Total Gross
                    </p>
                    <p className="font-black text-xl text-emerald-700">
                      ₹
                      {(
                        Number(editingSale.cbp_landline_amt) +
                        Number(editingSale.cbp_gsm_amt) +
                        Number(editingSale.ctop_recharge_amt) +
                        Number(editingSale.sim_replacement_amt) +
                        Number(editingSale.sim_fancy_amt) +
                        Number(editingSale.sim_postpaid_amt) +
                        Number(editingSale.other_amt) +
                        Number(editingSale.frc_amt) +
                        Number(editingSale.mnp_amt) +
                        Number(editingSale.pb_cbp_amt) +
                        Number(editingSale.pb_ctop_amt) +
                        Number(editingSale.pb_frc_amt) +
                        Number(editingSale.pb_mnp_amt) +
                        Number(editingSale.pb_other_amt)
                      ).toLocaleString("en-IN")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* CBP Block */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">
                    1. BSNL CBP Sales
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        LL Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.cbp_landline_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "cbp_landline_qty",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        LL ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.cbp_landline_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "cbp_landline_amt",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        GSM Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.cbp_gsm_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("cbp_gsm_qty", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        GSM ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.cbp_gsm_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("cbp_gsm_amt", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* CTOP Block */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">
                    2. BSNL CTOP &amp; FRC
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-blue-800">
                        CTOP Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.ctop_recharge_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "ctop_recharge_qty",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-blue-800">
                        CTOP ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.ctop_recharge_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "ctop_recharge_amt",
                            e.target.value
                          )
                        }
                        className={`${numInputClass} bg-blue-50 border-blue-200`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-emerald-800">
                        FRC Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.frc_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("frc_qty", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-emerald-800">
                        FRC ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.frc_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("frc_amt", e.target.value)
                        }
                        className={`${numInputClass} bg-emerald-50 border-emerald-200`}
                      />
                    </div>
                  </div>
                </div>

                {/* SIM Block */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">
                    3. BSNL SIM Tracking
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-purple-800">
                        MNP Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.mnp_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("mnp_qty", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div className="md:col-span-4">
                      <label className="text-[10px] font-bold text-purple-800">
                        MNP ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.mnp_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("mnp_amt", e.target.value)
                        }
                        className={`${numInputClass} bg-purple-50 border-purple-200`}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        New Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.sim_new_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("sim_new_qty", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Upgrd Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.sim_upgrade_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "sim_upgrade_qty",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Postpd Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.sim_postpaid_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "sim_postpaid_qty",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Replc Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.sim_replacement_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "sim_replacement_qty",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Fancy Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.sim_fancy_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("sim_fancy_qty", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>

                    <div className="md:col-start-3">
                      <label className="text-[10px] font-bold text-slate-500">
                        Postpd ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.sim_postpaid_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "sim_postpaid_amt",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Replc ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.sim_replacement_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange(
                            "sim_replacement_amt",
                            e.target.value
                          )
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Fancy ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.sim_fancy_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("sim_fancy_amt", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* Other / Cheque */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">
                    4. Adjustments &amp; Cheques
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Cheque Qty
                      </label>
                      <input
                        type="number"
                        value={editingSale.cheque_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("cheque_qty", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Total Cheque ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.cheque_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("cheque_amt", e.target.value)
                        }
                        className={`${numInputClass} bg-amber-50`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Other Text
                      </label>
                      <input
                        type="text"
                        value={editingSale.other_details || ""}
                        onChange={(e) =>
                          setEditingSale({
                            ...editingSale,
                            other_details: e.target.value,
                          })
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">
                        Other Cash ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.other_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("other_amt", e.target.value)
                        }
                        className={`${numInputClass} bg-emerald-50`}
                      />
                    </div>
                  </div>
                </div>

                {/* PAYBULL ISOLATION */}
                <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-200 shadow-sm lg:col-span-2">
                  <h4 className="font-black text-xs text-indigo-900 uppercase tracking-widest border-b border-indigo-200 pb-2 mb-4 flex items-center gap-2">
                    <span>💳</span> 5. Paybull Platform Adjustments
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-indigo-800">
                        PB CBP ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.pb_cbp_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("pb_cbp_amt", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-indigo-800">
                        PB CTOP ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.pb_ctop_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("pb_ctop_amt", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-indigo-800">
                        PB FRC ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.pb_frc_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("pb_frc_amt", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-indigo-800">
                        PB MNP ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.pb_mnp_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("pb_mnp_amt", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-indigo-800">
                        PB Other ₹
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingSale.pb_other_amt}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          handleEditInputChange("pb_other_amt", e.target.value)
                        }
                        className={numInputClass}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* STRICT COMPLIANCE SUBMISSION BLOCK */}
              <div className="bg-slate-900 p-6 rounded-xl shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                  <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">
                    Correction Reason Dropdown *
                  </label>
                  <select
                    required
                    value={correctionCategory}
                    onChange={(e) => {
                      setCorrectionCategory(e.target.value);
                      setOtherCorrectionText("");
                    }}
                    className="w-full bg-slate-800 border-2 border-slate-600 text-white font-bold text-sm rounded-lg p-3 outline-none focus:border-amber-500"
                  >
                    <option value="" disabled>
                      -- Select Strict Reason Code --
                    </option>
                    <option value="CBP correction">CBP correction</option>
                    <option value="CTOP / FRC correction">
                      CTOP / FRC correction
                    </option>
                    <option value="sim sales Correction">
                      SIM sales Correction
                    </option>
                    <option value="Paybull Correction">
                      Paybull Platform Correction
                    </option>
                    <option value="cheque correction">Cheque correction</option>
                    <option value="All above">All above</option>
                    <option value="Other">Other (Specify Below)</option>
                  </select>
                </div>

                {correctionCategory === "Other" && (
                  <div className="flex-1 w-full animate-in fade-in slide-in-from-top-2">
                    <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">
                      Manual Reason (Min 5 Chars) *
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="TYPE DETAILED REASON HERE..."
                      value={otherCorrectionText}
                      onChange={(e) =>
                        setOtherCorrectionText(e.target.value.toUpperCase())
                      }
                      className="w-full bg-slate-800 border-2 border-amber-600 text-white font-black uppercase tracking-wider text-sm rounded-lg p-3 outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                )}

                <div className="flex gap-2 w-full md:w-auto mt-4 md:mt-0">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="bg-slate-700 hover:bg-slate-600 text-white font-black px-6 py-3.5 rounded-lg shadow-md transition uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black px-8 py-3.5 rounded-lg shadow-md transition disabled:opacity-50 tracking-widest uppercase"
                  >
                    {isSubmitting ? "Overwriting..." : "Apply Overwrite"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: AADHAAR KENDRA DAILY REPORT FORCE CORRECTION MODAL           */}
      {/* ===================================================================== */}
      {isAadhaarEditOpen && editingAadhaar && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-50 rounded-2xl shadow-2xl border border-slate-300 w-full max-w-4xl my-8 animate-in fade-in zoom-in-95">
            <div className="p-5 bg-slate-900 flex justify-between items-center text-white rounded-t-2xl border-b-4 border-amber-500">
              <div>
                <h3 className="font-black text-xl flex items-center gap-2">
                  <span>🆔</span> Force Correction (Aadhaar Kendra):{" "}
                  {editingAadhaar.active_partners?.partner_name}
                </h3>
                <p className="text-amber-400 text-xs font-bold tracking-widest uppercase mt-1">
                  Target Date:{" "}
                  {formatToDDMMYYYY(
                    normalizeToYYYYMMDD(editingAadhaar.report_date)
                  )}{" "}
                  | Operator: {editingAadhaar.operator_id} | Station:{" "}
                  {editingAadhaar.station_id}
                </p>
              </div>
              <button
                onClick={() => setIsAadhaarEditOpen(false)}
                className="hover:text-amber-500 text-3xl font-black transition"
              >
                &times;
              </button>
            </div>

            <form
              onSubmit={handleAadhaarEditSubmit}
              className="p-6 md:p-8 space-y-6"
            >
              {editingAadhaar.edit_request_reason && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                    Partner Correction Request Note:
                  </p>
                  <p className="text-xs font-bold text-slate-900 mt-1">
                    &quot;{editingAadhaar.edit_request_reason}&quot;
                  </p>
                </div>
              )}

              {/* LIVE AADHAAR TOTALS BANNER */}
              {(() => {
                const tariff = getTariffForDate(editingAadhaar.report_date);
                const liveTotalPkts =
                  Number(editingAadhaar.cat1_new_qty || 0) +
                  Number(editingAadhaar.cat2_mbu_free_qty || 0) +
                  Number(editingAadhaar.cat3_mbu_chargeable_qty || 0) +
                  Number(editingAadhaar.cat4_demographic_qty || 0) +
                  Number(editingAadhaar.cat5_biometric_qty || 0);
                const liveCash = Number(
                  editingAadhaar.total_cash_collected || 0
                );
                const liveBase = Number(
                  (
                    liveCash /
                    (1 + Number(tariff.gst_percent || 18) / 100)
                  ).toFixed(2)
                );
                const liveGst = Number((liveCash - liveBase).toFixed(2));

                return (
                  <div className="bg-slate-900 text-white p-4 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-slate-400 uppercase font-black">
                        Total Packets
                      </p>
                      <p className="text-2xl font-black text-white">
                        {liveTotalPkts}
                      </p>
                    </div>
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-slate-400 uppercase font-black">
                        Net Base Fee
                      </p>
                      <p className="text-xl font-black text-slate-200">
                        ₹{liveBase.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-amber-400 uppercase font-black">
                        18% GST
                      </p>
                      <p className="text-xl font-black text-amber-400">
                        ₹{liveGst.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-emerald-950 border border-emerald-700 p-3 rounded-lg">
                      <p className="text-[9px] text-emerald-300 uppercase font-black">
                        Total Cash Collected
                      </p>
                      <p className="text-2xl font-black text-emerald-400">
                        ₹{liveCash.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* 1. 5-CATEGORY PACKET COUNTS */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <h4 className="font-black text-xs text-slate-600 uppercase tracking-widest border-b pb-2">
                  1. 5-Category Enrolment &amp; Update Counts (Auto-Calculates
                  Cash)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase">
                      1. New (₹0)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingAadhaar.cat1_new_qty}
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) =>
                        handleAadhaarQtyChange("cat1_new_qty", e.target.value)
                      }
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase">
                      2. MBU Free (₹0)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingAadhaar.cat2_mbu_free_qty}
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) =>
                        handleAadhaarQtyChange(
                          "cat2_mbu_free_qty",
                          e.target.value
                        )
                      }
                      className={numInputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-amber-800 uppercase">
                      3. MBU Paid
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingAadhaar.cat3_mbu_chargeable_qty}
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) =>
                        handleAadhaarQtyChange(
                          "cat3_mbu_chargeable_qty",
                          e.target.value
                        )
                      }
                      className={`${numInputClass} bg-amber-50 border-amber-300`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-blue-800 uppercase">
                      4. Demographic
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingAadhaar.cat4_demographic_qty}
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) =>
                        handleAadhaarQtyChange(
                          "cat4_demographic_qty",
                          e.target.value
                        )
                      }
                      className={`${numInputClass} bg-blue-50 border-blue-300`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-purple-800 uppercase">
                      5. Biometric
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingAadhaar.cat5_biometric_qty}
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) =>
                        handleAadhaarQtyChange(
                          "cat5_biometric_qty",
                          e.target.value
                        )
                      }
                      className={`${numInputClass} bg-purple-50 border-purple-300`}
                    />
                  </div>
                </div>
              </div>

              {/* 2. PACKET STATUS, IDS, DEPOSIT STATUS & OPTIONAL CASH OVERRIDE */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h4 className="font-black text-xs text-slate-600 uppercase tracking-widest border-b pb-2">
                    2. Packet Processing Status &amp; IDs
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-emerald-700">
                        Completed
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editingAadhaar.completed_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          setEditingAadhaar({
                            ...editingAadhaar,
                            completed_qty: Math.max(
                              0,
                              parseInt(e.target.value, 10) || 0
                            ),
                          })
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-blue-700">
                        InProcess
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editingAadhaar.inprocess_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          setEditingAadhaar({
                            ...editingAadhaar,
                            inprocess_qty: Math.max(
                              0,
                              parseInt(e.target.value, 10) || 0
                            ),
                          })
                        }
                        className={numInputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-red-700">
                        Rejected
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editingAadhaar.rejected_qty}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          setEditingAadhaar({
                            ...editingAadhaar,
                            rejected_qty: Math.max(
                              0,
                              parseInt(e.target.value, 10) || 0
                            ),
                          })
                        }
                        className={numInputClass}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">
                        Operator ID
                      </label>
                      <input
                        type="text"
                        value={editingAadhaar.operator_id}
                        onChange={(e) =>
                          setEditingAadhaar({
                            ...editingAadhaar,
                            operator_id: e.target.value.toUpperCase(),
                          })
                        }
                        className={`${numInputClass} uppercase`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">
                        Station ID
                      </label>
                      <input
                        type="text"
                        maxLength={5}
                        value={editingAadhaar.station_id}
                        onChange={(e) =>
                          setEditingAadhaar({
                            ...editingAadhaar,
                            station_id: e.target.value.replace(/\D/g, ""),
                          })
                        }
                        className={numInputClass}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex justify-between items-center border-b pb-2">
                    <h4 className="font-black text-xs text-slate-600 uppercase tracking-widest">
                      3. Cash &amp; Settlement Control
                    </h4>
                    <label className="flex items-center gap-1.5 text-[10px] font-black text-amber-700 uppercase cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualCashOverride}
                        onChange={(e) =>
                          setManualCashOverride(e.target.checked)
                        }
                        className="accent-amber-600"
                      />
                      Manual Cash Override
                    </label>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                      Total Cash Collected (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={!manualCashOverride}
                      value={editingAadhaar.total_cash_collected}
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) => {
                        const newCash = Math.max(
                          0,
                          parseFloat(e.target.value) || 0
                        );
                        setEditingAadhaar((prev: any) => ({
                          ...prev,
                          total_cash_collected: newCash,
                          deposit_status:
                            newCash === 0
                              ? "Settled"
                              : newCash > 0 &&
                                !prev.deposit_id &&
                                prev.deposit_status === "Settled"
                              ? "Pending Deposit"
                              : prev.deposit_status,
                        }));
                      }}
                      className={`${numInputClass} ${
                        !manualCashOverride
                          ? "bg-slate-100 text-slate-500 cursor-not-allowed"
                          : "bg-amber-50 border-amber-400"
                      }`}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                      Deposit Settlement Status
                    </label>
                    <select
                      value={editingAadhaar.deposit_status}
                      onChange={(e) =>
                        setEditingAadhaar({
                          ...editingAadhaar,
                          deposit_status: e.target.value,
                        })
                      }
                      className={numInputClass}
                    >
                      <option value="Pending Deposit">Pending Deposit</option>
                      <option value="Deposit Submitted">
                        Deposit Submitted
                      </option>
                      <option value="Settled">Settled</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* MANDATORY AADHAAR AUDIT REASON & SUBMIT */}
              <div className="bg-slate-900 p-6 rounded-xl shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                  <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">
                    Aadhaar Correction Reason *
                  </label>
                  <select
                    required
                    value={aadhaarCorrectionCategory}
                    onChange={(e) => {
                      setAadhaarCorrectionCategory(e.target.value);
                      setAadhaarOtherText("");
                    }}
                    className="w-full bg-slate-800 border-2 border-slate-600 text-white font-bold text-sm rounded-lg p-3 outline-none focus:border-amber-500"
                  >
                    <option value="" disabled>
                      -- Select Aadhaar Audit Reason Code --
                    </option>
                    <option value="5-Category Count Correction">
                      5-Category Count Correction
                    </option>
                    <option value="UIDAI CSV/HTML Parity Override">
                      UIDAI CSV/HTML Parity Override
                    </option>
                    <option value="Exemption / Zero-Day Correction">
                      Exemption / Zero-Day Correction
                    </option>
                    <option value="Tariff / Cash Ledger Adjustment">
                      Tariff / Cash Ledger Adjustment
                    </option>
                    <option value="Other">Other (Specify Below)</option>
                  </select>
                </div>

                {aadhaarCorrectionCategory === "Other" && (
                  <div className="flex-1 w-full animate-in fade-in">
                    <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">
                      Manual Audit Reason (Min 5 Chars) *
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="TYPE DETAILED REASON HERE..."
                      value={aadhaarOtherText}
                      onChange={(e) =>
                        setAadhaarOtherText(e.target.value.toUpperCase())
                      }
                      className="w-full bg-slate-800 border-2 border-amber-600 text-white font-black uppercase tracking-wider text-sm rounded-lg p-3 outline-none"
                    />
                  </div>
                )}

                <div className="flex gap-2 w-full md:w-auto mt-4 md:mt-0">
                  <button
                    type="button"
                    onClick={() => setIsAadhaarEditOpen(false)}
                    className="bg-slate-700 hover:bg-slate-600 text-white font-black px-6 py-3.5 rounded-lg shadow-md transition uppercase tracking-widest text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black px-8 py-3.5 rounded-lg shadow-md transition disabled:opacity-50 tracking-widest uppercase text-xs"
                  >
                    {isSubmitting
                      ? "Overwriting..."
                      : "Apply Aadhaar Overwrite"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}