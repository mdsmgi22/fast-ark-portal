"use client";

import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  formatToDDMMYYYY,
  getISTDateString,
  downloadAadhaarCSVReport,
  downloadAadhaarPDFReport,
} from "../../lib/aadhaarEngine";

type DatePresetMode =
  | "today"
  | "yesterday"
  | "current_week"
  | "current_month"
  | "previous_month"
  | "all"
  | "custom";

const getDateRangeFromPreset = (preset: DatePresetMode): { start: string; end: string } => {
  const now = new Date();
  const istNow = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);

  const formatYMD = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayStr = formatYMD(istNow);

  if (preset === "today") {
    return { start: todayStr, end: todayStr };
  }
  if (preset === "yesterday") {
    const yest = new Date(istNow);
    yest.setDate(yest.getDate() - 1);
    const yStr = formatYMD(yest);
    return { start: yStr, end: yStr };
  }
  if (preset === "current_week") {
    const startOfWeek = new Date(istNow);
    const day = startOfWeek.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
    return { start: formatYMD(startOfWeek), end: todayStr };
  }
  if (preset === "current_month") {
    const firstDay = new Date(istNow.getFullYear(), istNow.getMonth(), 1);
    return { start: formatYMD(firstDay), end: todayStr };
  }
  if (preset === "previous_month") {
    const firstDayPrev = new Date(istNow.getFullYear(), istNow.getMonth() - 1, 1);
    const lastDayPrev = new Date(istNow.getFullYear(), istNow.getMonth(), 0);
    return { start: formatYMD(firstDayPrev), end: formatYMD(lastDayPrev) };
  }
  if (preset === "all") {
    return { start: "2020-01-01", end: todayStr };
  }
  return { start: todayStr, end: todayStr };
};

export default function CorporateMISReports() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [adminUser, setAdminUser] = useState<any>(null);

  // Master Directory Data for 4-Tier Cascade
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [allPartners, setAllPartners] = useState<any[]>([]);

  // Target Ledger & Export Format
  const [exportType, setExportType] = useState<"sales" | "deposits" | "aadhaar">("sales");
  const [exportFormat, setExportFormat] = useState<"csv" | "pdf">("csv");
  const [statusFilter, setStatusFilter] = useState("All");

  // 7-Option Date Preset + Range State
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [dateRange, setDateRange] = useState(() => getDateRangeFromPreset("current_month"));

  // 4-Tier Geographic & Operator Cascading Filters
  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fOperator, setFOperator] = useState("ALL");

  useEffect(() => {
    initializeEngine();
  }, []);

  const initializeEngine = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [staffRes, locRes, partRes] = await Promise.all([
        supabase
          .from("back_office_staff")
          .select("id, email, role")
          .eq("email", session.user.email)
          .maybeSingle(),
        supabase.from("locations").select("*").order("center_name"),
        supabase
          .from("active_partners")
          .select("id, partner_name, aadhaar_operator_id, aadhaar_station_id, role, role_aadhaar, center_id, locations (id, state, dist, center_name, center_code, parent_master_id)")
          .order("partner_name"),
      ]);

      setAdminUser(staffRes.data || { email: session.user.email });
      setAllLocations(locRes.data || []);
      setAllPartners(partRes.data || []);
    } catch (err) {
      console.error("Initialization Error:", err);
    } finally {
      setIsInitializing(false);
    }
  };

  // =========================================================================
  // 4-TIER CASCADING OPTIONS (STATE -> MASTER HQ -> LOCATION -> OPERATOR)
  // =========================================================================
  const uniqueStates = useMemo(
    () => Array.from(new Set(allLocations.map((l) => l.state).filter(Boolean))).sort(),
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
        if (fHq !== "ALL" && l.parent_master_id?.toString() !== fHq) return false;
        if (fCenter !== "ALL" && l.id?.toString() !== fCenter) return false;
        return true;
      }),
    [allPartners, fState, fHq, fCenter]
  );

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      setDateRange(getDateRangeFromPreset(mode));
    }
  };

  const sanitizeCSV = (val: unknown): string => {
    let str = String(val || "").replace(/"/g, '""');
    if (/^[=+\-@]/.test(str)) {
      str = "'" + str;
    }
    return `"${str}"`;
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);

      if (startDate > endDate) {
        alert("Validation Error: Start Date cannot be after End Date.");
        setLoading(false);
        return;
      }

      // Enforce 31-day cap ONLY on custom date ranges (presets like 'all' or 'previous_month' are permitted)
      if (datePreset === "custom") {
        const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 31) {
          alert("System Warning: Custom date ranges are limited to 31 days. Use the 'All' or 'Previous Month' preset for larger extracts.");
          setLoading(false);
          return;
        }
      }

      const tableName =
        exportType === "sales"
          ? "daily_sales_reports"
          : exportType === "deposits"
          ? "partner_deposits"
          : "aadhaar_daily_reports";

      let query = supabase
        .from(tableName)
        .select(`*, active_partners (id, partner_name, aadhaar_operator_id, aadhaar_station_id, locations (id, state, dist, center_name, parent_master_id))`);

      if (exportType === "sales" || exportType === "aadhaar") {
        query = query
          .gte("report_date", dateRange.start)
          .lte("report_date", dateRange.end)
          .order("report_date", { ascending: false });
      } else {
        query = query
          .gte("created_at", `${dateRange.start}T00:00:00+05:30`)
          .lte("created_at", `${dateRange.end}T23:59:59+05:30`)
          .order("created_at", { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;

      let filteredData = data || [];

      // Apply 4-Tier Cascade & Status / File Mode Filters
      filteredData = filteredData.filter((row) => {
        const p = row.active_partners;
        const locData = p?.locations;
        const l: any = Array.isArray(locData) ? locData[0] : locData;

        if (fState !== "ALL" && l?.state !== fState) return false;
        if (fHq !== "ALL" && l?.parent_master_id?.toString() !== fHq) return false;
        if (fCenter !== "ALL" && l?.id?.toString() !== fCenter) return false;
        if (fOperator !== "ALL" && p?.id !== fOperator && row.partner_id !== fOperator) return false;

        if (statusFilter !== "All") {
          if (exportType === "deposits") {
            if (row.status !== statusFilter) return false;
          } else if (exportType === "sales") {
            if (statusFilter === "ZeroBiz" && !row.zero_business_reason) return false;
            if (statusFilter === "Edited" && !row.is_edited_by_staff) return false;
            if (statusFilter === "Standard" && (row.zero_business_reason || row.is_edited_by_staff)) return false;
          } else if (exportType === "aadhaar") {
            if (statusFilter === "WITH_FILES" && !row.has_files) return false;
            if (statusFilter === "WITHOUT_FILES" && row.has_files) return false;
          }
        }
        return true;
      });

      if (filteredData.length === 0) {
        alert(`No ${exportType.toUpperCase()} records found matching your cascading filters for ${formatToDDMMYYYY(dateRange.start)} to ${formatToDDMMYYYY(dateRange.end)}.`);
        setLoading(false);
        return;
      }

      if (adminUser?.email) {
        await supabase.from("staff_activity_logs").insert([
          {
            staff_id: adminUser.id || "SYS",
            staff_email: adminUser.email,
            action_type: "EXPORT",
            module: "MIS_REPORTS",
            target_id: exportFormat.toUpperCase(),
            details: `Exported ${filteredData.length} rows of ${exportType.toUpperCase()} (${exportFormat.toUpperCase()}). Preset: ${datePreset} (${formatToDDMMYYYY(dateRange.start)} to ${formatToDDMMYYYY(dateRange.end)}). State: ${fState}.`,
          },
        ]);
      }

      if (exportType === "aadhaar") {
        if (exportFormat === "pdf") {
          await downloadAadhaarPDFReport(
            filteredData,
            statusFilter,
            `State:${fState} | HQ:${fHq} | Loc:${fCenter} | Op:${fOperator}`
          );
        } else {
          downloadAadhaarCSVReport(filteredData, statusFilter);
        }
      } else {
        generateCSV(filteredData, exportType);
      }
    } catch (err: any) {
      alert("Error generating report: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateCSV = (data: Record<string, any>[], type: string) => {
    const flatData = data.map((row) => {
      const locData = row.active_partners?.locations;
      const l: any = Array.isArray(locData) ? locData[0] : locData;
      const hqName = allLocations.find((h) => h.id === l?.parent_master_id)?.center_name || "N/A";

      const baseRow: Record<string, unknown> = {
        Record_ID: row.id,
        Partner_Name: row.active_partners?.partner_name || "N/A",
        Center_Name: l?.center_name || "N/A",
        Master_HQ: hqName,
        State: l?.state || "N/A",
        District: l?.dist || "N/A",
      };

      if (type === "sales") {
        const totalCash =
          Number(row.cbp_landline_amt || 0) +
          Number(row.cbp_gsm_amt || 0) +
          Number(row.ctop_recharge_amt || 0) +
          Number(row.sim_replacement_amt || 0) +
          Number(row.sim_fancy_amt || 0) +
          Number(row.sim_postpaid_amt || 0) +
          Number(row.other_amt || 0) +
          Number(row.frc_amt || 0) +
          Number(row.mnp_amt || 0) +
          Number(row.pb_cbp_amt || 0) +
          Number(row.pb_ctop_amt || 0) +
          Number(row.pb_frc_amt || 0) +
          Number(row.pb_mnp_amt || 0) +
          Number(row.pb_other_amt || 0);

        return {
          ...baseRow,
          Report_Date: formatToDDMMYYYY(row.report_date),
          Total_Gross_Revenue: totalCash,
          Zero_Business_Reason: row.zero_business_reason || "",
          CBP_Landline_Amt: row.cbp_landline_amt || 0,
          CBP_GSM_Amt: row.cbp_gsm_amt || 0,
          CTOP_Recharge_Amt: row.ctop_recharge_amt || 0,
          FRC_Qty: row.frc_qty || 0,
          FRC_Amt: row.frc_amt || 0,
          MNP_Qty: row.mnp_qty || 0,
          MNP_Amt: row.mnp_amt || 0,
          SIM_Replacement_Amt: row.sim_replacement_amt || 0,
          SIM_Fancy_Amt: row.sim_fancy_amt || 0,
          SIM_Postpaid_Amt: row.sim_postpaid_amt || 0,
          Other_Amount: row.other_amt || 0,
          Cheque_Amount: row.cheque_amt || 0,
          Paybull_CBP_Amt: row.pb_cbp_amt || 0,
          Paybull_CTOP_Amt: row.pb_ctop_amt || 0,
          Paybull_FRC_Amt: row.pb_frc_amt || 0,
          Paybull_MNP_Amt: row.pb_mnp_amt || 0,
          Paybull_Other_Amt: row.pb_other_amt || 0,
          Edited_By_Admin: row.is_edited_by_staff ? "YES" : "NO",
          Audit_Remarks: row.staff_edit_remarks || "",
        };
      } else {
        return {
          ...baseRow,
          Remittance_Date: formatToDDMMYYYY(row.deposit_date || row.created_at),
          Method: row.deposit_method,
          Reference_No: row.reference_no || "",
          Amount_INR: row.deposit_amount,
          Audit_Status: row.status,
          Discrepancy_Remarks: row.rejection_reason || "",
          Exemption_Reason: row.exemption_reason || "",
        };
      }
    });

    if (flatData.length === 0) return;

    const headers = Object.keys(flatData[0]).join(",");
    const csvRows = flatData
      .map((row) => Object.values(row).map((val) => sanitizeCSV(val)).join(","))
      .join("\n");

    const csvContent = `${headers}\n${csvRows}`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `FastArk_${type.toUpperCase()}_MIS_${formatToDDMMYYYY(dateRange.start).replace(/\//g, "-")}_to_${formatToDDMMYYYY(
        dateRange.end
      ).replace(/\//g, "-")}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isInitializing)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto bg-slate-50 min-h-screen font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-200 pb-6 gap-4">
        <div>
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline mb-2 inline-block text-sm">
            &larr; Back to Command Center
          </Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <span className="text-4xl">📈</span> Corporate MIS Export Engine
          </h1>
          <p className="text-slate-500 font-medium mt-1">
            Generate cascading State / Master HQ / Location / Operator financial extracts in Indian Standard Format (DD/MM/YYYY).
          </p>
        </div>
      </div>

      <div className="bg-white p-6 md:p-8 rounded-xl border border-slate-200 shadow-sm">
        <form onSubmit={handleExport} className="space-y-8">
          {/* STEP 1: MODULE TARGET */}
          <div>
            <label className="block text-slate-700 font-black mb-3 uppercase tracking-widest text-xs border-b border-slate-100 pb-2">
              1. Select Target Ledger
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label
                className={`border-2 p-4 rounded-xl cursor-pointer transition flex items-center gap-3 shadow-sm ${
                  exportType === "sales" ? "border-indigo-600 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"
                }`}
              >
                <input
                  type="radio"
                  name="exportType"
                  value="sales"
                  checked={exportType === "sales"}
                  onChange={() => {
                    setExportType("sales");
                    setExportFormat("csv");
                    setStatusFilter("All");
                  }}
                  className="w-5 h-5 text-indigo-600"
                />
                <div>
                  <h3 className="font-black text-slate-900 text-sm">Partner Sales Ledger</h3>
                  <p className="text-[11px] text-slate-500 font-bold mt-0.5">Daily telecom &amp; Paybull sales</p>
                </div>
              </label>

              <label
                className={`border-2 p-4 rounded-xl cursor-pointer transition flex items-center gap-3 shadow-sm ${
                  exportType === "deposits" ? "border-amber-600 bg-amber-50" : "border-slate-200 hover:border-amber-300"
                }`}
              >
                <input
                  type="radio"
                  name="exportType"
                  value="deposits"
                  checked={exportType === "deposits"}
                  onChange={() => {
                    setExportType("deposits");
                    setExportFormat("csv");
                    setStatusFilter("All");
                  }}
                  className="w-5 h-5 text-amber-600"
                />
                <div>
                  <h3 className="font-black text-slate-900 text-sm">Cash Remittances</h3>
                  <p className="text-[11px] text-slate-500 font-bold mt-0.5">Bank deposits &amp; discrepancies</p>
                </div>
              </label>

              <label
                className={`border-2 p-4 rounded-xl cursor-pointer transition flex items-center gap-3 shadow-sm ${
                  exportType === "aadhaar" ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-emerald-300"
                }`}
              >
                <input
                  type="radio"
                  name="exportType"
                  value="aadhaar"
                  checked={exportType === "aadhaar"}
                  onChange={() => {
                    setExportType("aadhaar");
                    setStatusFilter("All");
                  }}
                  className="w-5 h-5 text-emerald-600"
                />
                <div>
                  <h3 className="font-black text-slate-900 text-sm">Aadhaar Kendra Reports</h3>
                  <p className="text-[11px] text-slate-500 font-bold mt-0.5">5-Category CSV/HTML &amp; PDF</p>
                </div>
              </label>
            </div>
          </div>

          {/* STEP 2: 7-OPTION DATE PRESET DROPDOWN & CUSTOM RANGE (DD/MM/YYYY) */}
          <div>
            <label className="block text-slate-700 font-black mb-3 uppercase tracking-widest text-xs border-b border-slate-100 pb-2">
              2. Select Date Range Preset (Indian Standard DD/MM/YYYY)
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-1.5">
                  Date Filter Dropdown *
                </label>
                <select
                  value={datePreset}
                  onChange={(e) => handlePresetChange(e.target.value as DatePresetMode)}
                  className="w-full border-2 border-indigo-300 p-3 rounded-lg outline-none focus:border-indigo-600 font-black text-sm text-indigo-950 bg-white"
                >
                  <option value="today">1. Today ({formatToDDMMYYYY(getDateRangeFromPreset("today").start)})</option>
                  <option value="yesterday">2. Yesterday ({formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})</option>
                  <option value="current_week">3. Current Week</option>
                  <option value="current_month">4. Current Month</option>
                  <option value="previous_month">5. Previous Month</option>
                  <option value="all">6. All Records</option>
                  <option value="custom">7. Custom Filter (Pick Dates)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  Start Date ({formatToDDMMYYYY(dateRange.start)}) *
                </label>
                <input
                  type="date"
                  required
                  value={dateRange.start}
                  onChange={(e) => {
                    setDatePreset("custom");
                    setDateRange({ ...dateRange, start: e.target.value });
                  }}
                  className="w-full border-2 border-slate-300 p-2.5 rounded-lg outline-none focus:border-indigo-500 font-bold text-sm text-slate-700 bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  End Date ({formatToDDMMYYYY(dateRange.end)}) *
                </label>
                <input
                  type="date"
                  required
                  value={dateRange.end}
                  max={getISTDateString(0)}
                  onChange={(e) => {
                    setDatePreset("custom");
                    setDateRange({ ...dateRange, end: e.target.value });
                  }}
                  className="w-full border-2 border-slate-300 p-2.5 rounded-lg outline-none focus:border-indigo-500 font-bold text-sm text-slate-700 bg-white"
                />
              </div>
            </div>
          </div>

          {/* STEP 3: 4-TIER GEOGRAPHIC & OPERATOR CASCADING FILTERS */}
          <div>
            <label className="block text-slate-700 font-black mb-3 uppercase tracking-widest text-xs border-b border-slate-100 pb-2">
              3. Cascading Hierarchy Filters (State &rarr; Master HQ &rarr; Location &rarr; Operator)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  1. State
                </label>
                <select
                  value={fState}
                  onChange={(e) => {
                    setFState(e.target.value);
                    setFHq("ALL");
                    setFCenter("ALL");
                    setFOperator("ALL");
                  }}
                  className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-3 outline-none focus:border-indigo-500"
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
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  2. Master HQ
                </label>
                <select
                  value={fHq}
                  onChange={(e) => {
                    setFHq(e.target.value);
                    setFCenter("ALL");
                    setFOperator("ALL");
                  }}
                  className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-3 outline-none focus:border-indigo-500"
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
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  3. Location (Center)
                </label>
                <select
                  value={fCenter}
                  onChange={(e) => {
                    setFCenter(e.target.value);
                    setFOperator("ALL");
                  }}
                  className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-3 outline-none focus:border-indigo-500"
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
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  4. Operator / Partner
                </label>
                <select
                  value={fOperator}
                  onChange={(e) => setFOperator(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-3 outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All Operators ({operatorOptions.length})</option>
                  {operatorOptions.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.partner_name} {op.aadhaar_operator_id ? `(${op.aadhaar_operator_id})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* STEP 4: STATUS / FILE MODE & FORMAT OPTIONS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-100">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  5. Status / File Submission Filter
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-xs rounded-lg p-3 outline-none focus:border-indigo-500"
                >
                  <option value="All">All Records (No Status Filter)</option>
                  {exportType === "deposits" && (
                    <>
                      <option value="Pending">Pending Audit Only</option>
                      <option value="Verified">Verified &amp; Cleared Only</option>
                      <option value="Discrepancy">Rejected Discrepancies Only</option>
                    </>
                  )}
                  {exportType === "sales" && (
                    <>
                      <option value="Standard">Standard Submissions</option>
                      <option value="ZeroBiz">Zero Business Days Only</option>
                      <option value="Edited">Admin Overrides Only</option>
                    </>
                  )}
                  {exportType === "aadhaar" && (
                    <>
                      <option value="WITH_FILES">✅ With CSV &amp; HTML Files Only</option>
                      <option value="WITHOUT_FILES">⚠️ Without Files (Manual / Exemption Only)</option>
                    </>
                  )}
                </select>
              </div>

              {exportType === "aadhaar" && (
                <div>
                  <label className="block text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-1.5">
                    6. Download Format (PDF or CSV)
                  </label>
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as "csv" | "pdf")}
                    className="w-full bg-emerald-50 border-2 border-emerald-300 text-emerald-950 font-black text-xs rounded-lg p-3 outline-none focus:border-emerald-600"
                  >
                    <option value="csv">📊 Excel CSV Format (.csv)</option>
                    <option value="pdf">📄 Official Watermarked A4 Landscape PDF (.pdf)</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-slate-900 hover:bg-indigo-600 text-white font-black text-sm uppercase tracking-widest rounded-xl shadow-lg transition disabled:bg-slate-400 flex justify-center items-center gap-3"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>
                  Generating Extract...
                </>
              ) : (
                <>
                  <span className="text-xl">{exportFormat === "pdf" && exportType === "aadhaar" ? "📄" : "📥"}</span>{" "}
                  Secure Download {exportType === "aadhaar" ? exportFormat.toUpperCase() : "CSV"} (
                  {formatToDDMMYYYY(dateRange.start)} to {formatToDDMMYYYY(dateRange.end)})
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}