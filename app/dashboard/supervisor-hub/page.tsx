// FILE PATH: ./app/dashboard/supervisor-hub/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
  downloadAadhaarCSVReport,
} from "../../lib/aadhaarEngine";

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes("T")) return dateStr.split("T")[0];
  return dateStr;
};

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

type SupervisorStreamFilter = "ALL" | "TELECOM" | "AADHAAR";

export default function SupervisorHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [staffProfile, setStaffProfile] = useState<any>(null);

  // UI State - 5 dedicated tabs + Option X 3-in-1 Vertical Stream Switcher
  const [activeTab, setActiveTab] = useState<
    "activity" | "sales" | "aadhaar" | "deposits" | "compliance"
  >("activity");
  const [streamFilter, setStreamFilter] =
    useState<SupervisorStreamFilter>("ALL");
  const [viewingSlipId, setViewingSlipId] = useState<string | null>(null);

  // Architecture & Raw Data State
  const [allocatedLocations, setAllocatedLocations] = useState<any[]>([]);
  const [masterHQs, setMasterHQs] = useState<any[]>([]);
  const [regionalPartners, setRegionalPartners] = useState<any[]>([]);
  const [regionalSales, setRegionalSales] = useState<any[]>([]);
  const [regionalDeposits, setRegionalDeposits] = useState<any[]>([]);
  const [regionalAadhaar, setRegionalAadhaar] = useState<any[]>([]);
  const [regionalPenalties, setRegionalPenalties] = useState<any[]>([]);

  // Action State
  const [isNudging, setIsNudging] = useState<string | null>(null);

  // 4-TIER CASCADING FILTER + 7-PRESET DATE DROPDOWN STATE
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [toDate, setToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );

  const [stateFilter, setStateFilter] = useState("ALL");
  const [hqFilter, setHqFilter] = useState("ALL");
  const [centerFilter, setCenterFilter] = useState("ALL");
  const [operatorFilter, setOperatorFilter] = useState("ALL");

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  useEffect(() => {
    initializeSupervisorEngine();
  }, []);

  const initializeSupervisorEngine = async () => {
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

      const safeRole = String(staff?.role || "")
        .trim()
        .toLowerCase();
      if (
        !staff ||
        staff.status !== "Active" ||
        !["supervisor", "admin", "manager"].includes(safeRole)
      ) {
        return router.push("/login");
      }
      setStaffProfile(staff);

      const { data: allocations } = await supabase
        .from("supervisor_allocations")
        .select(
          "location_id, manage_cm, manage_ocsc, manage_aadhaar, manage_partner"
        )
        .eq("supervisor_id", staff.auth_id);

      if (!allocations || allocations.length === 0) {
        setAllocatedLocations([]);
        setLoading(false);
        return;
      }

      const allowedLocIds = allocations.map((a) => a.location_id);
      const permissionMap: Record<number, any> = {};
      allocations.forEach((a) => {
        permissionMap[a.location_id] = a;
      });

      const [locsRes, partnersRes, hqRes] = await Promise.all([
        supabase.from("locations").select("*").in("id", allowedLocIds),
        supabase
          .from("active_partners")
          .select(
            "*, locations(id, center_name, center_code, state, parent_master_id)"
          )
          .in("center_id", allowedLocIds)
          .eq("status", "Active"),
        supabase
          .from("locations")
          .select("id, center_name, state")
          .eq("is_master_node", true),
      ]);

      const allocatedLocs = locsRes.data || [];
      setAllocatedLocations(allocatedLocs);

      const relevantHqIds = new Set();
      allocatedLocs.forEach((loc) => {
        if (loc.parent_master_id) relevantHqIds.add(loc.parent_master_id);
        if (loc.is_master_node) relevantHqIds.add(loc.id);
      });

      const rawHqs = hqRes.data || [];
      const isolatedHQs = rawHqs.filter((hq) => relevantHqIds.has(hq.id));
      setMasterHQs(isolatedHQs);

      const rawPartners = partnersRes.data || [];

      const permittedPartners = rawPartners.filter((p) => {
        const rules = permissionMap[p.center_id];
        if (!rules) return false;

        const r = (p.role || "").toUpperCase();
        if (r.includes("CM") && rules.manage_cm) return true;
        if (r.includes("OCSC") && rules.manage_ocsc) return true;
        if ((r.includes("AADHAAR") || p.role_aadhaar) && rules.manage_aadhaar)
          return true;
        if ((r === "PARTNER" || r.includes("IRCTC")) && rules.manage_partner)
          return true;

        return false;
      });

      setRegionalPartners(permittedPartners);

      const permittedPartnerIds = permittedPartners.map((p) => p.id);
      if (permittedPartnerIds.length === 0) {
        setRegionalSales([]);
        setRegionalDeposits([]);
        setRegionalAadhaar([]);
        setRegionalPenalties([]);
        setLoading(false);
        return;
      }

      const [salesRes, depositsRes, aadhaarRes, penRes] = await Promise.all([
        supabase
          .from("daily_sales_reports")
          .select(
            "*, active_partners(partner_name, locations(id, center_name, center_code, state, parent_master_id))"
          )
          .in("partner_id", permittedPartnerIds)
          .order("report_date", { ascending: false }),
        supabase
          .from("partner_deposits")
          .select(
            "*, active_partners(partner_name, locations(id, center_name, center_code, state, parent_master_id))"
          )
          .in("partner_id", permittedPartnerIds)
          .order("deposit_date", { ascending: false }),
        supabase
          .from("aadhaar_daily_reports")
          .select(
            "*, active_partners(partner_name, locations(id, center_name, center_code, state, parent_master_id))"
          )
          .in("partner_id", permittedPartnerIds)
          .order("report_date", { ascending: false }),
        supabase
          .from("aadhaar_penalty_logs")
          .select("*")
          .in("partner_id", permittedPartnerIds)
          .eq("is_settled", false),
      ]);

      setRegionalSales(salesRes.data || []);
      setRegionalDeposits(depositsRes.data || []);
      setRegionalAadhaar(aadhaarRes.data || []);
      setRegionalPenalties(
        (penRes.data || []).filter((p: any) => !p.is_waived)
      );
    } catch (err: any) {
      console.error("Supervisor Init Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- VAULT DECRYPTION ENGINE ---
  const handleViewSecureSlip = async (deposit: any) => {
    setViewingSlipId(deposit.id);

    try {
      if (String(deposit.deposit_slip_url || "").startsWith("http")) {
        window.open(deposit.deposit_slip_url, "_blank");
        setViewingSlipId(null);
        return;
      }

      const { data, error } = await supabase.storage
        .from("deposit-slips")
        .createSignedUrl(deposit.deposit_slip_url, 60);

      if (error || !data) throw new Error("Vault Access Denied");

      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      alert("Error loading slip: " + err.message);
    } finally {
      setViewingSlipId(null);
    }
  };

  const handleViewAadhaarVaultFile = async (path: string | null) => {
    if (!path) return alert("No file attached (Manual / Exemption record).");
    const { data, error } = await supabase.storage
      .from("aadhaar-reports")
      .createSignedUrl(path, 120);
    if (error || !data?.signedUrl)
      return alert("Error generating secure download link.");
    window.open(data.signedUrl, "_blank");
  };

  // --- DISPATCH NUDGE ENGINE ---
  const handleRegionalNudge = async (partner: any, issueType: string) => {
    if (
      !confirm(
        `Dispatch an official regional alert to ${partner.partner_name}?`
      )
    )
      return;

    setIsNudging(partner.id);
    try {
      let subject = "Regional Compliance Notice";
      let body = `Dear ${partner.partner_name},\n\nYour regional supervisor has flagged your account for immediate action:\n\n`;

      if (issueType === "CASH") {
        subject = "Urgent: Cash Limit Exceeded";
        body += `⚠️ You have exceeded the allowable pending cash limit. Please deposit your pending balances into the corporate accounts immediately and upload the slip to avoid operational suspension.`;
      } else if (issueType === "SALES") {
        subject = "Urgent: Missing Daily Report";
        body += `❌ You have failed to log your end-of-day sales or Aadhaar report. Please access your dashboard and submit your report immediately to maintain network compliance.`;
      }

      const { error } = await supabase.from("partner_messages").insert([
        {
          partner_id: partner.id,
          subject: `🚨 ALERT: ${subject}`,
          body: body,
        },
      ]);

      if (error) throw error;

      await supabase.from("staff_activity_logs").insert([
        {
          staff_id: staffProfile.id,
          staff_email: staffProfile.email,
          action_type: "DISPATCH_ALERT",
          module: "MESSAGES",
          target_id: partner.id,
          details: `Dispatched Regional Nudge to ${partner.partner_name} for ${issueType} compliance.`,
        },
      ]);

      alert(`✅ Regional Nudge securely dispatched to ${partner.partner_name}.`);
    } catch (err: any) {
      alert("Error sending nudge: " + err.message);
    } finally {
      setIsNudging(null);
    }
  };

  const handleSignOut = async () => {
    localStorage.removeItem("fapl_session_token");
    localStorage.removeItem("fapl_last_active_ts");
    await supabase.auth.signOut();
    router.push("/login");
  };

  // --- 4-TIER CASCADING FILTER LOGIC ---
  const uniqueStates = useMemo(
    () =>
      Array.from(
        new Set(
          regionalPartners.map((p) => p.locations?.state).filter(Boolean)
        )
      ).sort(),
    [regionalPartners]
  );

  const cascadeHQs = useMemo(
    () =>
      masterHQs.filter(
        (hq) => stateFilter === "ALL" || hq.state === stateFilter
      ),
    [masterHQs, stateFilter]
  );

  const cascadeCenters = useMemo(
    () =>
      allocatedLocations.filter(
        (loc) =>
          !loc.is_master_node &&
          (stateFilter === "ALL" || loc.state === stateFilter) &&
          (hqFilter === "ALL" || loc.parent_master_id?.toString() === hqFilter)
      ),
    [allocatedLocations, stateFilter, hqFilter]
  );

  const cascadeOperators = useMemo(
    () =>
      regionalPartners.filter((p) => {
        const loc = p.locations;
        if (stateFilter !== "ALL" && loc?.state !== stateFilter) return false;
        if (
          hqFilter !== "ALL" &&
          loc?.parent_master_id?.toString() !== hqFilter
        )
          return false;
        if (
          centerFilter !== "ALL" &&
          p.center_id?.toString() !== centerFilter &&
          loc?.id?.toString() !== centerFilter
        )
          return false;
        return true;
      }),
    [regionalPartners, stateFilter, hqFilter, centerFilter]
  );

  const filteredPartners = useMemo(() => {
    return cascadeOperators.filter((p) => {
      if (operatorFilter !== "ALL" && p.id !== operatorFilter) return false;
      if (streamFilter === "AADHAAR") {
        return Boolean(
          p.role_aadhaar ||
            p.aadhaar_station_id ||
            String(p.role || "")
              .toUpperCase()
              .includes("AADHAAR")
        );
      }
      return true;
    });
  }, [cascadeOperators, operatorFilter, streamFilter]);

  const filteredSales = useMemo(() => {
    return regionalSales.filter((s) => {
      const d = normalizeToYYYYMMDD(s.report_date);
      const isTimeMatch = d >= fromDate && d <= toDate;
      const isPartnerMatch = filteredPartners.some(
        (p) => p.id === s.partner_id
      );
      return isTimeMatch && isPartnerMatch;
    });
  }, [regionalSales, filteredPartners, fromDate, toDate]);

  const filteredAadhaar = useMemo(() => {
    return regionalAadhaar.filter((a) => {
      const d = normalizeToYYYYMMDD(a.report_date);
      const isTimeMatch = d >= fromDate && d <= toDate;
      const isPartnerMatch = filteredPartners.some(
        (p) => p.id === a.partner_id
      );
      return isTimeMatch && isPartnerMatch;
    });
  }, [regionalAadhaar, filteredPartners, fromDate, toDate]);

  const filteredDeposits = useMemo(() => {
    const isAdh = (d: any) =>
      d.deposit_stream === "AADHAAR" ||
      String(d.reference_no || "")
        .toUpperCase()
        .startsWith("AADHAAR_");

    return regionalDeposits.filter((d) => {
      const date = normalizeToYYYYMMDD(d.deposit_date || d.created_at);
      const isTimeMatch = date >= fromDate && date <= toDate;
      const isPartnerMatch = filteredPartners.some(
        (p) => p.id === d.partner_id
      );
      if (!isTimeMatch || !isPartnerMatch) return false;
      if (streamFilter === "AADHAAR" && !isAdh(d)) return false;
      if (streamFilter === "TELECOM" && isAdh(d)) return false;
      return true;
    });
  }, [regionalDeposits, filteredPartners, fromDate, toDate, streamFilter]);

  // --- OPTION X: DYNAMIC VERTICAL MORPHING METRICS ---
  const verticalMetrics = useMemo(() => {
    const isAdh = (d: any) =>
      d.deposit_stream === "AADHAAR" ||
      String(d.reference_no || "")
        .toUpperCase()
        .startsWith("AADHAAR_");

    let cbpLL = 0,
      cbpGsm = 0,
      cbp = 0,
      ctop = 0,
      frcMnp = 0,
      simCardsCash = 0,
      otherCash = 0,
      simTotalCash = 0,
      paybull = 0,
      cheque = 0,
      telecomGenerated = 0;

    let qNew = 0,
      qUpgrade = 0,
      qReplace = 0,
      qFancy = 0,
      qMnp = 0,
      qFrc = 0,
      qPostpaid = 0;

    filteredSales.forEach((s) => {
      const sLL = Number(s.cbp_landline_amt || 0);
      const sGsm = Number(s.cbp_gsm_amt || 0);
      const sCtop = Number(s.ctop_recharge_amt || 0);
      const sFrcMnp = Number(s.frc_amt || 0) + Number(s.mnp_amt || 0);
      const sSimCards =
        Number(s.sim_replacement_amt || 0) +
        Number(s.sim_fancy_amt || 0) +
        Number(s.sim_postpaid_amt || 0);
      const sOther = Number(s.other_amt || 0);
      const sPb =
        Number(s.pb_cbp_amt || 0) +
        Number(s.pb_ctop_amt || 0) +
        Number(s.pb_frc_amt || 0) +
        Number(s.pb_mnp_amt || 0) +
        Number(s.pb_other_amt || 0);

      cbpLL += sLL;
      cbpGsm += sGsm;
      cbp += sLL + sGsm;
      ctop += sCtop;
      frcMnp += sFrcMnp;
      simCardsCash += sSimCards;
      otherCash += sOther;
      simTotalCash += sFrcMnp + sSimCards + sOther;
      paybull += sPb;
      cheque += Number(s.cheque_amt || 0);
      telecomGenerated +=
        sLL + sGsm + sCtop + sFrcMnp + sSimCards + sOther + sPb;

      qNew += Number(s.sim_new_qty || 0);
      qUpgrade += Number(s.sim_upgrade_qty || 0);
      qReplace += Number(s.sim_replacement_qty || 0);
      qFancy += Number(s.sim_fancy_qty || 0);
      qMnp += Number(s.mnp_qty || 0);
      qFrc += Number(s.frc_qty || 0);
      qPostpaid += Number(s.sim_postpaid_qty || 0);
    });

    let adhCat1 = 0,
      adhCat2 = 0,
      adhCat3 = 0,
      adhCat4 = 0,
      adhCat5 = 0,
      aadhaarPackets = 0,
      adhCompleted = 0,
      adhRejected = 0,
      adhBase = 0,
      adhGst = 0,
      aadhaarGenerated = 0;

    filteredAadhaar.forEach((a) => {
      adhCat1 += Number(a.cat1_new_qty || 0);
      adhCat2 += Number(a.cat2_mbu_free_qty || 0);
      adhCat3 += Number(a.cat3_mbu_chargeable_qty || 0);
      adhCat4 += Number(a.cat4_demographic_qty || 0);
      adhCat5 += Number(a.cat5_biometric_qty || 0);
      aadhaarPackets += Number(a.total_packets_qty || 0);
      adhCompleted += Number(a.completed_qty || 0);
      adhRejected += Number(a.rejected_qty || 0);
      adhBase += Number(a.base_amount || 0);
      adhGst += Number(a.gst_amount || 0);
      aadhaarGenerated += Number(a.total_cash_collected || 0);
    });

    let telecomDeposited = 0;
    let aadhaarDeposited = 0;
    regionalDeposits
      .filter((d) => {
        if (d.status === "Discrepancy") return false;
        const dt = normalizeToYYYYMMDD(d.deposit_date || d.created_at);
        if (dt < fromDate || dt > toDate) return false;
        return filteredPartners.some((p) => p.id === d.partner_id);
      })
      .forEach((d) => {
        if (isAdh(d)) aadhaarDeposited += Number(d.deposit_amount || 0);
        else telecomDeposited += Number(d.deposit_amount || 0);
      });

    const totalPrepaidSims =
      qNew + qUpgrade + qReplace + qFancy + qMnp + qFrc;
    const totalSims = totalPrepaidSims + qPostpaid;

    return {
      cbpLL,
      cbpGsm,
      cbp,
      ctop,
      frcMnp,
      simCardsCash,
      otherCash,
      simTotalCash,
      paybull,
      cheque,
      telecomGenerated,
      telecomDeposited,
      telecomPending: Math.max(0, telecomGenerated - telecomDeposited),
      adhCat1,
      adhCat2,
      adhCat3,
      adhCat4,
      adhCat5,
      aadhaarPackets,
      adhCompleted,
      adhRejected,
      adhBase,
      adhGst,
      aadhaarGenerated,
      aadhaarDeposited,
      aadhaarPending: Math.max(0, aadhaarGenerated - aadhaarDeposited),
      totalGenerated: telecomGenerated + aadhaarGenerated,
      totalDeposited: telecomDeposited + aadhaarDeposited,
      qNew,
      qUpgrade,
      qReplace,
      qFancy,
      qMnp,
      qFrc,
      qPostpaid,
      totalPrepaidSims,
      totalSims,
    };
  }, [
    filteredSales,
    filteredAadhaar,
    regionalDeposits,
    filteredPartners,
    fromDate,
    toDate,
  ]);

  // Compute Compliance & Activity Audit Matrix (Respects Active Vertical Stream)
  const complianceMatrix = useMemo(() => {
    const isAadhaarDep = (d: any) =>
      d.deposit_stream === "AADHAAR" ||
      String(d.reference_no || "")
        .toUpperCase()
        .startsWith("AADHAAR_");

    return filteredPartners.map((p) => {
      const pSalesTime = filteredSales.filter((s) => s.partner_id === p.id);
      const pAadhaarTime = filteredAadhaar.filter(
        (a) => a.partner_id === p.id
      );

      const hasLoggedActivity =
        streamFilter === "TELECOM"
          ? pSalesTime.length > 0
          : streamFilter === "AADHAAR"
          ? pAadhaarTime.length > 0
          : pSalesTime.length > 0 || pAadhaarTime.length > 0;

      const pSalesLifetime = regionalSales.filter((s) => s.partner_id === p.id);
      const pValidDeposits = regionalDeposits.filter(
        (d) => d.partner_id === p.id && d.status !== "Discrepancy"
      );
      const pTelecomDeposits = pValidDeposits.filter((d) => !isAadhaarDep(d));
      const pAadhaarDeposits = pValidDeposits.filter((d) => isAadhaarDep(d));

      const pAadhaarLifetime = regionalAadhaar.filter(
        (a) => a.partner_id === p.id
      );
      const pPenaltiesUnsettled = regionalPenalties.filter(
        (pen) => pen.partner_id === p.id && !pen.is_waived
      );

      let lifetimeTelecomCash = 0;
      pSalesLifetime.forEach((s) => {
        lifetimeTelecomCash +=
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

      const lifetimeTelecomDep = pTelecomDeposits.reduce(
        (sum, d) => sum + Number(d.deposit_amount || 0),
        0
      );

      const lifetimeAadhaarCash = pAadhaarLifetime.reduce(
        (sum, a) => sum + Number(a.total_cash_collected || 0),
        0
      );
      const lifetimeAadhaarDep = pAadhaarDeposits.reduce(
        (sum, d) => sum + Number(d.deposit_amount || 0),
        0
      );

      const telecomDue = Math.max(0, lifetimeTelecomCash - lifetimeTelecomDep);
      const aadhaarCashDue = Math.max(
        0,
        lifetimeAadhaarCash - lifetimeAadhaarDep
      );
      const aadhaarPenaltyDue = pPenaltiesUnsettled.reduce(
        (sum, pen) => sum + Number(pen.penalty_amount || 0),
        0
      );

      const pendingBalance =
        streamFilter === "TELECOM"
          ? telecomDue
          : streamFilter === "AADHAAR"
          ? aadhaarCashDue + aadhaarPenaltyDue
          : telecomDue + aadhaarCashDue + aadhaarPenaltyDue;

      return {
        ...p,
        hasLoggedActivity,
        pendingBalance,
        isDefaulter: pendingBalance > 1000 || !hasLoggedActivity,
      };
    });
  }, [
    filteredPartners,
    filteredSales,
    filteredAadhaar,
    regionalSales,
    regionalDeposits,
    regionalAadhaar,
    regionalPenalties,
    streamFilter,
  ]);

  // --- CSV EXPORT ENGINE (WITH VERTICAL-SCOPED DEFAULTER EXPORT) ---
  const downloadCSV = (
    type:
      | "activity"
      | "sales"
      | "deposits"
      | "compliance"
      | "missing_reports"
  ) => {
    let headers: string[] = [];
    let csvData: any[] = [];
    const fileName = `FastArk_Supervisor_${streamFilter}_${type.toUpperCase()}_${formatToDDMMYYYY(
      fromDate
    ).replace(/\//g, "-")}_to_${formatToDDMMYYYY(toDate).replace(/\//g, "-")}`;

    if (type === "activity") {
      headers = [
        "Vertical Mode",
        "Partner Name",
        "Role",
        "Center Code",
        "Center Name",
        "State",
        "Activity Status",
        "Pending Cash Due (INR)",
      ];
      csvData = complianceMatrix.map((p) => [
        sanitizeCSV(streamFilter),
        sanitizeCSV(p.partner_name),
        sanitizeCSV(p.role),
        sanitizeCSV(p.locations?.center_code || "NO-CODE"),
        sanitizeCSV(p.locations?.center_name),
        sanitizeCSV(p.locations?.state),
        p.hasLoggedActivity ? "Logged" : "Missing",
        p.pendingBalance,
      ]);
    } else if (type === "missing_reports") {
      headers = [
        "Vertical Mode",
        "Partner Name",
        "Role",
        "UIDAI Station ID",
        "Center Code",
        "Center Name",
        "State",
        "Mobile",
        "Report Status",
      ];
      const missingList = complianceMatrix.filter((p) => !p.hasLoggedActivity);
      if (missingList.length === 0)
        return alert("All associates have submitted reports in this window.");
      csvData = missingList.map((p) => [
        sanitizeCSV(streamFilter),
        sanitizeCSV(p.partner_name),
        sanitizeCSV(p.role),
        sanitizeCSV(p.aadhaar_station_id || "N/A"),
        sanitizeCSV(p.locations?.center_code || "NO-CODE"),
        sanitizeCSV(p.locations?.center_name),
        sanitizeCSV(p.locations?.state),
        sanitizeCSV(p.mobile || "N/A"),
        "Missing Submission",
      ]);
    } else if (type === "sales") {
      headers = [
        "Report Date (DD/MM/YYYY)",
        "State",
        "Master HQ",
        "Center Code",
        "Center Name",
        "Partner Name",
        "BSNL CBP Revenue",
        "BSNL CTOP Revenue",
        "BSNL SIM Revenue",
        "Paybull Revenue",
        "Total Gross Revenue",
        "Audit Status",
      ];
      csvData = filteredSales.map((s) => {
        const cbp =
          Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0);
        const ctop = Number(s.ctop_recharge_amt || 0);
        const sim =
          Number(s.sim_replacement_amt || 0) +
          Number(s.sim_fancy_amt || 0) +
          Number(s.sim_postpaid_amt || 0) +
          Number(s.other_amt || 0) +
          Number(s.frc_amt || 0) +
          Number(s.mnp_amt || 0);
        const pb =
          Number(s.pb_cbp_amt || 0) +
          Number(s.pb_ctop_amt || 0) +
          Number(s.pb_frc_amt || 0) +
          Number(s.pb_mnp_amt || 0) +
          Number(s.pb_other_amt || 0);
        const total = cbp + ctop + sim + pb;
        const hqName =
          masterHQs.find(
            (h) => h.id === s.active_partners?.locations?.parent_master_id
          )?.center_name || "N/A";

        return [
          formatToDDMMYYYY(s.report_date),
          sanitizeCSV(s.active_partners?.locations?.state),
          sanitizeCSV(hqName),
          sanitizeCSV(s.active_partners?.locations?.center_code || "NO-CODE"),
          sanitizeCSV(s.active_partners?.locations?.center_name),
          sanitizeCSV(s.active_partners?.partner_name),
          cbp,
          ctop,
          sim,
          pb,
          total,
          s.is_edited_by_staff ? "Audited/Edited" : "Original",
        ];
      });
    } else if (type === "deposits") {
      headers = [
        "Date (DD/MM/YYYY)",
        "System Reference Code",
        "Partner Name",
        "Center Code",
        "Method",
        "Unique UTR No",
        "Transaction ID",
        "Amount (INR)",
        "Status",
      ];
      csvData = filteredDeposits.map((d) => {
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
          formatToDDMMYYYY(normalizeToYYYYMMDD(d.deposit_date || d.created_at)),
          sanitizeCSV(refCode),
          sanitizeCSV(d.active_partners?.partner_name),
          sanitizeCSV(d.active_partners?.locations?.center_code || "NO-CODE"),
          d.deposit_method,
          sanitizeCSV(cleanUtr),
          sanitizeCSV(cleanTxn),
          d.deposit_amount,
          d.status,
        ];
      });
    } else if (type === "compliance") {
      headers = [
        "Vertical Mode",
        "Flagged Partner",
        "Role",
        "Center Code",
        "Center Name",
        "State",
        "Missing Report (Period)",
        "Lifetime Pending Cash (INR)",
      ];
      const defaulters = complianceMatrix.filter((p) => p.isDefaulter);
      csvData = defaulters.map((p) => [
        sanitizeCSV(streamFilter),
        sanitizeCSV(p.partner_name),
        sanitizeCSV(p.role),
        sanitizeCSV(p.locations?.center_code || "NO-CODE"),
        sanitizeCSV(p.locations?.center_name),
        sanitizeCSV(p.locations?.state),
        p.hasLoggedActivity ? "Logged" : "Missing",
        p.pendingBalance,
      ]);
      if (defaulters.length === 0)
        return alert("No defaulters found to export.");
    }

    if (csvData.length === 0)
      return alert("No data available to export for current filters.");

    const csvContent = [
      headers.join(","),
      ...csvData.map((row) => row.join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.csv`;
    link.click();
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
      </div>
    );

  if (allocatedLocations.length === 0)
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white p-12 rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full text-center">
          <div className="text-6xl mb-6">🗺️</div>
          <h2 className="text-2xl font-black text-slate-900 mb-2">
            No Territory Allocated
          </h2>
          <p className="text-slate-500 font-medium mb-8">
            Your account is active, but the corporate office has not yet
            assigned any centers to your regional perimeter.
          </p>
          <button
            onClick={handleSignOut}
            className="bg-slate-900 text-white font-black px-6 py-3 rounded-lg w-full uppercase tracking-widest hover:bg-slate-800 transition shadow-md"
          >
            Sign Out
          </button>
        </div>
      </div>
    );

  const activeGenerated =
    streamFilter === "TELECOM"
      ? verticalMetrics.telecomGenerated
      : streamFilter === "AADHAAR"
      ? verticalMetrics.aadhaarGenerated
      : verticalMetrics.totalGenerated;

  const activeDeposited =
    streamFilter === "TELECOM"
      ? verticalMetrics.telecomDeposited
      : streamFilter === "AADHAAR"
      ? verticalMetrics.aadhaarDeposited
      : verticalMetrics.totalDeposited;

  const activeShortfall = Math.max(0, activeGenerated - activeDeposited);
  const settlementPct =
    activeGenerated > 0
      ? Math.min(100, (activeDeposited / activeGenerated) * 100)
      : activeDeposited > 0
      ? 100
      : 0;

  return (
    <div className="min-h-screen bg-slate-100 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">🔭</span> Field Supervisor Command Hub
            </h1>
            <p className="text-slate-500 mt-1 font-medium text-sm">
              Regional Command Desk for:{" "}
              <span className="font-black text-slate-800">
                {staffProfile?.name}
              </span>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <span className="text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1 rounded shadow-sm tracking-widest">
                {allocatedLocations.length} Centers Monitored
              </span>
              <span className="text-[10px] font-black uppercase bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1 rounded shadow-sm tracking-widest">
                {regionalPartners.length} Permitted Associates
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={initializeSupervisorEngine}
              className="bg-slate-100 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-black hover:bg-slate-200 shadow-sm transition text-xs uppercase tracking-widest"
            >
              ↻ Refresh Data
            </button>
            <button
              onClick={handleSignOut}
              className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-black hover:bg-red-600 shadow-sm transition text-xs uppercase tracking-widest"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* OPTION X: REVENUE & REMITTANCE RECONCILIATION CONTROL PANEL (3-IN-1 MORPHING) */}
        <div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden">
          <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div>
              <h2 className="text-white font-black text-base uppercase tracking-wider flex items-center gap-2">
                <span>📈</span> Revenue &amp; Remittance Reconciliation Control
                Panel
              </h2>
              <p className="text-xs font-bold text-slate-400 mt-1">
                Active Window:{" "}
                <span className="text-blue-400">
                  {formatToDDMMYYYY(fromDate)}
                </span>{" "}
                to{" "}
                <span className="text-blue-400">
                  {formatToDDMMYYYY(toDate)}
                </span>{" "}
                • Morphs KPIs, SIM Counts &amp; Defaulter Watchlists by Vertical
              </p>
            </div>

            <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-[10px] font-black uppercase">
              <button
                type="button"
                onClick={() => setStreamFilter("ALL")}
                className={`px-3.5 py-2 rounded-lg transition ${
                  streamFilter === "ALL"
                    ? "bg-blue-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                🌐 All Verticals
              </button>
              <button
                type="button"
                onClick={() => setStreamFilter("TELECOM")}
                className={`px-3.5 py-2 rounded-lg transition ${
                  streamFilter === "TELECOM"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                📡 1. BSNL + Paybull
              </button>
              <button
                type="button"
                onClick={() => setStreamFilter("AADHAAR")}
                className={`px-3.5 py-2 rounded-lg transition ${
                  streamFilter === "AADHAAR"
                    ? "bg-amber-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                🆔 2. Aadhaar Kendra
              </button>
            </div>
          </div>

          {/* 4-TIER CASCADING FILTER + 7-OPTION DATE PRESET BAR */}
          <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  1. State Filter
                </label>
                <select
                  value={stateFilter}
                  onChange={(e) => {
                    setStateFilter(e.target.value);
                    setHqFilter("ALL");
                    setCenterFilter("ALL");
                    setOperatorFilter("ALL");
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs rounded-lg p-2.5 outline-none focus:border-blue-500"
                >
                  <option value="ALL">All States</option>
                  {uniqueStates.map((st: string) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  2. Master HQ Filter
                </label>
                <select
                  value={hqFilter}
                  onChange={(e) => {
                    setHqFilter(e.target.value);
                    setCenterFilter("ALL");
                    setOperatorFilter("ALL");
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs rounded-lg p-2.5 outline-none focus:border-blue-500"
                >
                  <option value="ALL">All Master HQs</option>
                  {cascadeHQs.map((hq) => (
                    <option key={hq.id} value={hq.id}>
                      {hq.center_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  3. Location / Center [Code]
                </label>
                <select
                  value={centerFilter}
                  onChange={(e) => {
                    setCenterFilter(e.target.value);
                    setOperatorFilter("ALL");
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs rounded-lg p-2.5 outline-none focus:border-blue-500"
                >
                  <option value="ALL">All Centers</option>
                  {cascadeCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.center_code || "NO-CODE"}] {c.center_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  4. Operator / Associate
                </label>
                <select
                  value={operatorFilter}
                  onChange={(e) => setOperatorFilter(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs rounded-lg p-2.5 outline-none focus:border-blue-500"
                >
                  <option value="ALL">
                    All Associates ({cascadeOperators.length})
                  </option>
                  {cascadeOperators.map((op) => (
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
              <div>
                <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-1">
                  5. Date Range Preset
                </label>
                <select
                  value={datePreset}
                  onChange={(e) =>
                    handlePresetChange(e.target.value as DatePresetMode)
                  }
                  className="w-full bg-slate-800 border-2 border-indigo-500/70 text-white font-black text-xs rounded-lg p-2.5 outline-none focus:border-indigo-400"
                >
                  <option value="today">
                    1. Today (
                    {formatToDDMMYYYY(getDateRangeFromPreset("today").start)})
                  </option>
                  <option value="yesterday">
                    2. Yesterday (
                    {formatToDDMMYYYY(
                      getDateRangeFromPreset("yesterday").start
                    )}
                    )
                  </option>
                  <option value="current_week">3. Current Week</option>
                  <option value="current_month">4. Current Month</option>
                  <option value="previous_month">5. Previous Month</option>
                  <option value="all">6. All Time</option>
                  <option value="custom">7. Custom Filter</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  From Date ({formatToDDMMYYYY(fromDate)})
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setDatePreset("custom");
                    setFromDate(e.target.value);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs font-bold outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
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
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs font-bold outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* VISUAL SETTLEMENT PROGRESS BAR */}
          <div className="p-4 bg-slate-950/90 border-b border-slate-800 space-y-2">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs font-black">
              <span className="text-white uppercase tracking-wider">
                🎯 Territory Settlement Progress ({streamFilter}):
              </span>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">
                  Deposited: ₹{activeDeposited.toLocaleString("en-IN")}
                </span>
                <span className="text-slate-600">/</span>
                <span className="text-blue-400">
                  Generated: ₹{activeGenerated.toLocaleString("en-IN")}
                </span>
                <span className="bg-slate-800 text-amber-400 px-2.5 py-0.5 rounded-full text-[11px]">
                  {settlementPct.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  settlementPct >= 90
                    ? "bg-emerald-500"
                    : settlementPct >= 70
                    ? "bg-amber-500"
                    : "bg-red-500"
                }`}
                style={{ width: `${settlementPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-bold">
              <span className="text-slate-400 uppercase">
                Territory Shortfall: ₹{activeShortfall.toLocaleString("en-IN")}
              </span>
              <span className="text-slate-400 uppercase">
                Total SIMs Sold: {verticalMetrics.totalSims} Qty | Aadhaar
                Packets: {verticalMetrics.aadhaarPackets} Pkts
              </span>
            </div>
          </div>

          {/* MORPHING KPI DECK BY VERTICAL */}
          {streamFilter === "AADHAAR" ? (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-slate-800">
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-emerald-400 font-black uppercase">
                  1. New (Free)
                </p>
                <p className="text-xl font-black text-white mt-0.5">
                  {verticalMetrics.adhCat1}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-teal-400 font-black uppercase">
                  2. MBU Free
                </p>
                <p className="text-xl font-black text-white mt-0.5">
                  {verticalMetrics.adhCat2}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-amber-400 font-black uppercase">
                  3. MBU Paid
                </p>
                <p className="text-xl font-black text-amber-400 mt-0.5">
                  {verticalMetrics.adhCat3}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-blue-400 font-black uppercase">
                  4. Demographic
                </p>
                <p className="text-xl font-black text-blue-300 mt-0.5">
                  {verticalMetrics.adhCat4}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-purple-400 font-black uppercase">
                  5. Biometric
                </p>
                <p className="text-xl font-black text-purple-300 mt-0.5">
                  {verticalMetrics.adhCat5}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5 border-l-2 border-amber-500">
                <p className="text-[9px] text-amber-400 font-black uppercase">
                  Aadhaar Cash
                </p>
                <p className="text-xl font-black text-white mt-0.5">
                  ₹{verticalMetrics.aadhaarGenerated.toLocaleString("en-IN")}
                </p>
              </div>
            </div>
          ) : streamFilter === "TELECOM" ? (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-slate-800">
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-slate-400 font-black uppercase">
                  CBP (LL + GSM)
                </p>
                <p className="text-lg font-black text-white mt-0.5">
                  ₹{verticalMetrics.cbp.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-blue-400 font-black uppercase">
                  CTOP Recharge
                </p>
                <p className="text-lg font-black text-blue-300 mt-0.5">
                  ₹{verticalMetrics.ctop.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-emerald-400 font-black uppercase">
                  SIM / FRC / MNP
                </p>
                <p className="text-lg font-black text-emerald-300 mt-0.5">
                  ₹{verticalMetrics.simTotalCash.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-indigo-400 font-black uppercase">
                  Paybull Cash
                </p>
                <p className="text-lg font-black text-indigo-400 mt-0.5">
                  ₹{verticalMetrics.paybull.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-purple-400 font-black uppercase">
                  Total SIMs Sold
                </p>
                <p className="text-lg font-black text-white mt-0.5">
                  {verticalMetrics.totalSims} Qty
                </p>
              </div>
              <div className="bg-slate-900 p-3.5 border-l-2 border-indigo-500">
                <p className="text-[9px] text-indigo-300 font-black uppercase">
                  Telecom Cash
                </p>
                <p className="text-lg font-black text-white mt-0.5">
                  ₹{verticalMetrics.telecomGenerated.toLocaleString("en-IN")}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-slate-800">
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-slate-400 font-black uppercase">
                  BSNL CBP + CTOP
                </p>
                <p className="text-lg font-black text-white mt-0.5">
                  ₹
                  {(
                    verticalMetrics.cbp + verticalMetrics.ctop
                  ).toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-emerald-400 font-black uppercase">
                  SIM / FRC / MNP
                </p>
                <p className="text-lg font-black text-white mt-0.5">
                  ₹{verticalMetrics.simTotalCash.toLocaleString("en-IN")} (
                  {verticalMetrics.totalSims} SIMs)
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-indigo-400 font-black uppercase">
                  Paybull Cash
                </p>
                <p className="text-lg font-black text-indigo-400 mt-0.5">
                  ₹{verticalMetrics.paybull.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5">
                <p className="text-[9px] text-amber-400 font-black uppercase">
                  Aadhaar Cash
                </p>
                <p className="text-lg font-black text-amber-400 mt-0.5">
                  ₹{verticalMetrics.aadhaarGenerated.toLocaleString("en-IN")} (
                  {verticalMetrics.aadhaarPackets} Pkts)
                </p>
              </div>
              <div className="bg-slate-900 p-3.5 border-l-2 border-blue-500">
                <p className="text-[9px] text-blue-400 font-black uppercase">
                  Total Generated
                </p>
                <p className="text-lg font-black text-white mt-0.5">
                  ₹{verticalMetrics.totalGenerated.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-900 p-3.5 border-l-2 border-emerald-500">
                <p className="text-[9px] text-emerald-400 font-black uppercase">
                  Total Deposited
                </p>
                <p className="text-lg font-black text-emerald-400 mt-0.5">
                  ₹{verticalMetrics.totalDeposited.toLocaleString("en-IN")}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
          <button
            onClick={() => setActiveTab("activity")}
            className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${
              activeTab === "activity"
                ? "bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]"
                : "bg-slate-200/70 text-slate-600 hover:bg-slate-200"
            }`}
          >
            1. Daily Activity Audit
          </button>
          <button
            onClick={() => setActiveTab("sales")}
            className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${
              activeTab === "sales"
                ? "bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]"
                : "bg-slate-200/70 text-slate-600 hover:bg-slate-200"
            }`}
          >
            2. Telecom Sales ({filteredSales.length})
          </button>
          <button
            onClick={() => setActiveTab("aadhaar")}
            className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${
              activeTab === "aadhaar"
                ? "bg-white text-amber-600 border-t-2 border-l border-r border-amber-600 mb-[-1px]"
                : "bg-slate-200/70 text-slate-600 hover:bg-slate-200"
            }`}
          >
            3. Aadhaar Kendra ({filteredAadhaar.length})
          </button>
          <button
            onClick={() => setActiveTab("deposits")}
            className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${
              activeTab === "deposits"
                ? "bg-white text-blue-600 border-t-2 border-l border-r border-blue-600 mb-[-1px]"
                : "bg-slate-200/70 text-slate-600 hover:bg-slate-200"
            }`}
          >
            4. Deposit Ledger ({filteredDeposits.length})
          </button>
          <button
            onClick={() => setActiveTab("compliance")}
            className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${
              activeTab === "compliance"
                ? "bg-white text-red-600 border-t-2 border-l border-r border-red-600 mb-[-1px]"
                : "bg-slate-200/70 text-slate-600 hover:bg-slate-200"
            }`}
          >
            5. Escalations (
            {complianceMatrix.filter((p) => p.isDefaulter).length})
          </button>
        </div>

        {/* ========================================================== */}
        {/* MODULE 1: DAILY ACTIVITY AUDIT                             */}
        {/* ========================================================== */}
        {activeTab === "activity" && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center text-white gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm">
                  Daily Activity Audit ({streamFilter})
                </h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">
                  Cross-referencing submissions ({formatToDDMMYYYY(fromDate)} to{" "}
                  {formatToDDMMYYYY(toDate)})
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadCSV("missing_reports")}
                  className="bg-red-600 hover:bg-red-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm"
                >
                  📥 Export Missing Reports CSV (
                  {complianceMatrix.filter((p) => !p.hasLoggedActivity).length})
                </button>
                <button
                  onClick={() => downloadCSV("activity")}
                  className="bg-emerald-600 hover:bg-emerald-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm"
                >
                  📥 Export Full Activity CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-4 font-black">
                      Associate &amp; Mapped Center Code
                    </th>
                    <th className="p-4 font-black text-center border-l border-slate-200">
                      Activity Status ({formatToDDMMYYYY(fromDate)} -{" "}
                      {formatToDDMMYYYY(toDate)})
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {complianceMatrix.map((p) => (
                    <tr key={p.id} className="transition hover:bg-slate-50">
                      <td className="p-4">
                        <div className="flex items-start gap-2.5 flex-wrap">
                          <p className="font-black text-slate-900 text-base">
                            {p.partner_name}
                          </p>
                          <span className="text-[9px] font-black uppercase text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded mt-0.5">
                            {p.role}
                          </span>
                          {(p.role_aadhaar || p.aadhaar_station_id) && (
                            <span className="text-[9px] font-black uppercase text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded mt-0.5">
                              🆔 Op: {p.aadhaar_operator_id || "N/A"} | Stn:{" "}
                              {p.aadhaar_station_id || "N/A"}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                          📍 [{p.locations?.center_code || "NO-CODE"}]{" "}
                          {p.locations?.center_name} ({p.locations?.state})
                        </p>
                      </td>
                      <td className="p-4 text-center border-l border-slate-100">
                        {p.hasLoggedActivity ? (
                          <span className="bg-green-100 text-green-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-green-200 shadow-sm">
                            ✅ Active / Logged
                          </span>
                        ) : (
                          <span className="bg-red-100 text-red-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-red-200 shadow-sm">
                            ❌ Missing Submission
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {complianceMatrix.length === 0 && (
                    <tr>
                      <td
                        colSpan={2}
                        className="p-12 text-center font-bold text-slate-400"
                      >
                        No active associates found matching your cascading
                        filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* MODULE 2: REGIONAL TELECOM SALES REPORTS                   */}
        {/* ========================================================== */}
        {activeTab === "sales" && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center text-white gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm text-indigo-400 flex items-center gap-2">
                  <span>📈</span> Regional Sales Reports
                </h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">
                  Window: {formatToDDMMYYYY(fromDate)} to{" "}
                  {formatToDDMMYYYY(toDate)}
                </p>
              </div>
              <div className="flex gap-4 items-center">
                <div className="text-right border-r border-slate-700 pr-4">
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                    Total Sales
                  </p>
                  <p className="font-black text-lg text-indigo-400">
                    ₹{verticalMetrics.telecomGenerated.toLocaleString("en-IN")}
                  </p>
                </div>
                <button
                  onClick={() => downloadCSV("sales")}
                  className="bg-indigo-600 hover:bg-indigo-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm"
                >
                  📥 Export Sales CSV
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="p-4 font-black">Date &amp; Center [Code]</th>
                    <th className="p-4 font-black text-right border-l">
                      BSNL CBP/CTOP
                    </th>
                    <th className="p-4 font-black text-right">BSNL SIMs</th>
                    <th className="p-4 font-black text-right text-indigo-600 bg-indigo-50/30 border-l">
                      Paybull Cash
                    </th>
                    <th className="p-4 font-black text-right text-slate-800 bg-slate-100 border-l">
                      Total Gross (₹)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-slate-400 font-bold"
                      >
                        No sales logged in your perimeter for this period.
                      </td>
                    </tr>
                  ) : (
                    filteredSales.map((s) => {
                      const cbpCtop =
                        Number(s.cbp_landline_amt || 0) +
                        Number(s.cbp_gsm_amt || 0) +
                        Number(s.ctop_recharge_amt || 0);
                      const simCash =
                        Number(s.sim_replacement_amt || 0) +
                        Number(s.sim_fancy_amt || 0) +
                        Number(s.sim_postpaid_amt || 0) +
                        Number(s.other_amt || 0) +
                        Number(s.frc_amt || 0) +
                        Number(s.mnp_amt || 0);
                      const pbCash =
                        Number(s.pb_cbp_amt || 0) +
                        Number(s.pb_ctop_amt || 0) +
                        Number(s.pb_frc_amt || 0) +
                        Number(s.pb_mnp_amt || 0) +
                        Number(s.pb_other_amt || 0);
                      const totalGross = cbpCtop + simCash + pbCash;

                      return (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="p-4">
                            <p className="font-black text-slate-800">
                              {formatToDDMMYYYY(s.report_date)}
                            </p>
                            <p className="font-bold text-slate-600 mt-1 truncate max-w-[200px]">
                              {s.active_partners?.partner_name}
                            </p>
                            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">
                              📍 [
                              {s.active_partners?.locations?.center_code ||
                                "NO-CODE"}
                              ] {s.active_partners?.locations?.center_name}
                            </p>
                            {s.is_edited_by_staff && (
                              <span className="inline-block mt-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 text-[8px] font-black uppercase tracking-widest rounded">
                                Audited / Edited
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-right font-medium border-l">
                            ₹{cbpCtop.toLocaleString("en-IN")}
                          </td>
                          <td className="p-4 text-right font-medium">
                            ₹{simCash.toLocaleString("en-IN")}
                          </td>
                          <td className="p-4 text-right font-black text-indigo-600 bg-indigo-50/10 border-l">
                            ₹{pbCash.toLocaleString("en-IN")}
                          </td>
                          <td className="p-4 text-right font-black text-slate-800 bg-slate-50 border-l">
                            ₹{totalGross.toLocaleString("en-IN")}
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

        {/* ========================================================== */}
        {/* MODULE 3: REGIONAL AADHAAR KENDRA AUDIT & FILE VAULT       */}
        {/* ========================================================== */}
        {activeTab === "aadhaar" && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center text-white gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm text-amber-400 flex items-center gap-2">
                  <span>🆔</span> Regional Aadhaar Kendra Reports &amp; File
                  Vault
                </h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">
                  5-Category Enrolment &amp; Cash Audit (
                  {formatToDDMMYYYY(fromDate)} to {formatToDDMMYYYY(toDate)})
                </p>
              </div>
              <div className="flex gap-4 items-center">
                <div className="text-right border-r border-slate-700 pr-4">
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                    Aadhaar Cash
                  </p>
                  <p className="font-black text-lg text-amber-400">
                    ₹{verticalMetrics.aadhaarGenerated.toLocaleString("en-IN")}
                  </p>
                </div>
                <button
                  onClick={() =>
                    downloadAadhaarCSVReport(
                      filteredAadhaar,
                      `Supervisor_${datePreset}`
                    )
                  }
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm"
                >
                  📥 Export Aadhaar CSV
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="p-4 font-black">Date (DD/MM/YYYY)</th>
                    <th className="p-4 font-black">
                      Operator, Station &amp; Center Code
                    </th>
                    <th className="p-4 font-black text-center">New</th>
                    <th className="p-4 font-black text-center">MBU(F)</th>
                    <th className="p-4 font-black text-center">MBU(P)</th>
                    <th className="p-4 font-black text-center">Demo</th>
                    <th className="p-4 font-black text-center">Bio</th>
                    <th className="p-4 font-black text-center">Total Pkts</th>
                    <th className="p-4 font-black text-right">Cash (₹)</th>
                    <th className="p-4 font-black text-center">Status</th>
                    <th className="p-4 font-black text-center">Vault Files</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAadhaar.length === 0 ? (
                    <tr>
                      <td
                        colSpan={11}
                        className="p-8 text-center text-slate-400 font-bold"
                      >
                        No Aadhaar reports logged in your territory for this
                        period.
                      </td>
                    </tr>
                  ) : (
                    filteredAadhaar.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="p-4 font-black text-slate-900">
                          {formatToDDMMYYYY(a.report_date)}
                        </td>
                        <td className="p-4">
                          <p className="font-black text-slate-800">
                            {a.active_partners?.partner_name}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500">
                            {a.operator_id} | Stn: {a.station_id} | [
                            {a.active_partners?.locations?.center_code ||
                              "NO-CODE"}
                            ] {a.active_partners?.locations?.center_name}
                          </p>
                        </td>
                        <td className="p-4 text-center font-bold">
                          {a.cat1_new_qty}
                        </td>
                        <td className="p-4 text-center font-bold">
                          {a.cat2_mbu_free_qty}
                        </td>
                        <td className="p-4 text-center font-bold">
                          {a.cat3_mbu_chargeable_qty}
                        </td>
                        <td className="p-4 text-center font-bold">
                          {a.cat4_demographic_qty}
                        </td>
                        <td className="p-4 text-center font-bold">
                          {a.cat5_biometric_qty}
                        </td>
                        <td className="p-4 text-center font-black">
                          {a.total_packets_qty}
                        </td>
                        <td className="p-4 text-right font-black text-slate-900">
                          ₹
                          {Number(a.total_cash_collected).toLocaleString(
                            "en-IN"
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                              a.deposit_status === "Pending Deposit"
                                ? "bg-red-100 text-red-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {a.deposit_status}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {a.has_files ? (
                            <div className="flex justify-center gap-1">
                              <button
                                onClick={() =>
                                  handleViewAadhaarVaultFile(a.csv_file_url)
                                }
                                className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                              >
                                CSV
                              </button>
                              <button
                                onClick={() =>
                                  handleViewAadhaarVaultFile(a.html_file_url)
                                }
                                className="bg-indigo-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                              >
                                HTML
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-amber-700 font-bold">
                              Manual ({a.exemption_reason})
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
        )}

        {/* ========================================================== */}
        {/* MODULE 4: REGIONAL DEPOSITS LEDGER                         */}
        {/* ========================================================== */}
        {activeTab === "deposits" && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-slate-800 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm text-blue-400 flex items-center gap-2">
                  <span>🏦</span> Regional Deposit Feed ({streamFilter})
                </h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">
                  Bank Remittances, Ref Codes, Unique UTRs &amp; Proofs (
                  {formatToDDMMYYYY(fromDate)} to {formatToDDMMYYYY(toDate)})
                </p>
              </div>
              <button
                onClick={() => downloadCSV("deposits")}
                className="bg-blue-600 hover:bg-blue-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm"
              >
                📥 Export Deposits CSV
              </button>
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="p-4">Date, Ref Code &amp; Center [Code]</th>
                    <th className="p-4">Method, Unique UTR &amp; Txn ID</th>
                    <th className="p-4 text-right">Amount (₹)</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-right">Bank Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDeposits.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-slate-400 font-bold"
                      >
                        No deposits logged in your perimeter for this period.
                      </td>
                    </tr>
                  ) : (
                    filteredDeposits.map((d) => {
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
                        `${isAadhaar ? "FA-ADH" : "FA-DEP"}-${String(
                          d.id || ""
                        )
                          .slice(0, 6)
                          .toUpperCase()}`;

                      return (
                        <tr key={d.id} className="hover:bg-slate-50">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <p className="font-black text-slate-800">
                                {formatToDDMMYYYY(
                                  normalizeToYYYYMMDD(
                                    d.deposit_date || d.created_at
                                  )
                                )}
                              </p>
                              <span className="font-mono text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded">
                                {refCode}
                              </span>
                            </div>
                            <p className="font-bold text-slate-600 mt-1 truncate max-w-[200px]">
                              {d.active_partners?.partner_name}
                            </p>
                            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">
                              📍 [
                              {d.active_partners?.locations?.center_code ||
                                "NO-CODE"}
                              ] {d.active_partners?.locations?.center_name}
                            </p>
                          </td>
                          <td className="p-4">
                            <span className="text-[10px] font-black uppercase text-blue-600">
                              {isAadhaar ? "🆔 Aadhaar • " : ""}
                              {d.deposit_method}
                            </span>
                            <p className="text-xs font-black text-slate-900 mt-0.5">
                              UTR: {cleanUtr}
                            </p>
                            <p className="text-[10px] font-bold text-slate-500">
                              Txn: {cleanTxn}
                            </p>
                          </td>
                          <td className="p-4 text-right">
                            <p
                              className={`font-black text-lg ${
                                d.status === "Discrepancy"
                                  ? "text-slate-400 line-through"
                                  : "text-slate-900"
                              }`}
                            >
                              ₹{Number(d.deposit_amount).toLocaleString("en-IN")}
                            </p>
                          </td>
                          <td className="p-4 text-center">
                            <span
                              className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                                d.status === "Verified"
                                  ? "bg-green-100 text-green-700 border-green-200"
                                  : d.status === "Discrepancy"
                                  ? "bg-red-100 text-red-700 border-red-200"
                                  : "bg-amber-100 text-amber-700 border-amber-200"
                              }`}
                            >
                              {d.status}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            {d.is_exempted ? (
                              <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest">
                                ⚠️ Exempted
                              </span>
                            ) : d.deposit_slip_url ? (
                              <button
                                onClick={() => handleViewSecureSlip(d)}
                                disabled={viewingSlipId === d.id}
                                className="bg-slate-800 hover:bg-slate-700 text-white font-black px-3 py-1.5 rounded shadow-sm text-[9px] uppercase tracking-widest transition disabled:opacity-50"
                              >
                                {viewingSlipId === d.id
                                  ? "Decrypting..."
                                  : "📄 View Slip"}
                              </button>
                            ) : (
                              <span className="text-[9px] text-slate-400 uppercase font-bold">
                                No Proof
                              </span>
                            )}
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

        {/* ========================================================== */}
        {/* MODULE 5: COMPLIANCE & ESCALATIONS                         */}
        {/* ========================================================== */}
        {activeTab === "compliance" && (
          <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-red-500 flex flex-col md:flex-row justify-between items-start md:items-center text-white gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm text-red-400 flex items-center gap-2">
                  <span>🚨</span> Regional Defaulter Matrix ({streamFilter})
                </h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 tracking-widest uppercase">
                  Missing reports or exceeding lifetime cash limits
                </p>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="bg-red-950 text-red-400 font-black px-3 py-1.5 rounded text-[10px] uppercase tracking-widest border border-red-800">
                  {complianceMatrix.filter((p) => p.isDefaulter).length} Flagged
                </span>
                <button
                  onClick={() => downloadCSV("missing_reports")}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 transition px-3.5 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm"
                >
                  📥 Export Missing Reports
                </button>
                <button
                  onClick={() => downloadCSV("compliance")}
                  className="bg-red-600 hover:bg-red-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm"
                >
                  📥 Export All Defaulters
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-red-50 text-[10px] uppercase tracking-widest text-red-800 border-b border-red-200 sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="p-4 font-black">
                      Flagged Associate &amp; Center Code
                    </th>
                    <th className="p-4 font-black text-center">
                      Missing Report (Period)
                    </th>
                    <th className="p-4 font-black text-center">
                      Pending Cash ({streamFilter})
                    </th>
                    <th className="p-4 font-black text-right">Field Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {complianceMatrix.filter((p) => p.isDefaulter).length ===
                  0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="p-16 text-center text-slate-500 font-bold text-lg"
                      >
                        🎉 Your territory is perfectly compliant. No defaulters.
                      </td>
                    </tr>
                  ) : (
                    complianceMatrix
                      .filter((p) => p.isDefaulter)
                      .map((p) => (
                        <tr
                          key={p.id}
                          className="hover:bg-red-50/30 transition"
                        >
                          <td className="p-4">
                            <div className="flex items-start gap-2">
                              <p className="font-black text-slate-900 text-base">
                                {p.partner_name}
                              </p>
                              <span className="text-[9px] font-black uppercase text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                                {p.role}
                              </span>
                            </div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                              📍 [{p.locations?.center_code || "NO-CODE"}]{" "}
                              {p.locations?.center_name}
                            </p>
                          </td>
                          <td className="p-4 text-center">
                            {!p.hasLoggedActivity ? (
                              <span className="bg-red-100 text-red-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-red-200">
                                ❌ Missing
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400 uppercase">
                                Logged
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            {p.pendingBalance > 1000 ? (
                              <div className="flex flex-col items-center">
                                <span className="text-red-600 font-black text-lg">
                                  ₹{p.pendingBalance.toLocaleString("en-IN")}
                                </span>
                                <span className="text-[9px] font-black text-red-500 uppercase tracking-widest mt-0.5">
                                  ⚠️ Limit Breach
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
                          <td className="p-4 text-right">
                            <button
                              onClick={() =>
                                handleRegionalNudge(
                                  p,
                                  !p.hasLoggedActivity ? "SALES" : "CASH"
                                )
                              }
                              disabled={isNudging === p.id}
                              className="bg-red-600 hover:bg-red-700 text-white font-black px-4 py-2 rounded text-[10px] uppercase tracking-widest shadow-md transition disabled:opacity-50 flex items-center gap-2 ml-auto"
                            >
                              {isNudging === p.id
                                ? "Dispatching..."
                                : "🔔 Send Regional Nudge"}
                            </button>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}