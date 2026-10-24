// FILE PATH: ./app/dashboard/aadhaar/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import AdminOperatorMappingModule from "../../components/aadhaar/AdminOperatorMappingModule";
import { reportAndMaskError, logSystemTelemetry } from "../../lib/errorCodes";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
  downloadAadhaarCSVReport,
  downloadAadhaarPDFReport,
} from "../../lib/aadhaarEngine";

type AdminAadhaarMenu =
  | "overview"
  | "daily_vault"
  | "collections"
  | "station_status"
  | "weekly_audit"
  | "penalties"
  | "operators"
  | "tariff_master";

type ReportGroupingMode = "DAILY_LEDGER" | "STATION_WISE" | "OPERATOR_WISE";

type StationWorkingFilter =
  | "ALL"
  | "WORKING"
  | "LEAVE_ABSENT"
  | "TECH_OUTAGE"
  | "HOLIDAY"
  | "NON_WORKING_UNLOGGED";

const noScrollNumClass =
  "w-full border-2 border-slate-200 p-2 rounded-lg font-black text-slate-900 bg-white outline-none focus:border-blue-600 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function AdminAadhaarCommandHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeMenu, setActiveMenu] = useState<AdminAadhaarMenu>("overview");
  const [staffUser, setStaffUser] = useState<any>(null);

  // Live IST Clock & DD/MM/YYYY Date
  const [liveDateDDMMYYYY, setLiveDateDDMMYYYY] = useState<string>("");
  const [liveTimeIST, setLiveTimeIST] = useState<string>("");

  // Raw Database Streams
  const [locations, setLocations] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<any[]>([]);
  const [aadhaarDeposits, setAadhaarDeposits] = useState<any[]>([]);
  const [penaltyLogs, setPenaltyLogs] = useState<any[]>([]);
  const [upgradeRequests, setUpgradeRequests] = useState<any[]>([]);
  const [tariffHistory, setTariffHistory] = useState<any[]>([]);

  // 7-Option Date Preset + Custom Range States
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [toDate, setToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );

  // 5-Tier Cascading Filters (State -> Master HQ -> Aadhaar Center -> Station ID -> Operator)
  const [fState, setFState] = useState<string>("ALL");
  const [fHq, setFHq] = useState<string>("ALL");
  const [fCenter, setFCenter] = useState<string>("ALL");
  const [fStation, setFStation] = useState<string>("ALL");
  const [fPartner, setFPartner] = useState<string>("ALL");
  const [fFileMode, setFFileMode] = useState<"ALL" | "WITH_FILES" | "WITHOUT_FILES">("ALL");

  // Sub-filters for Collections (Menu 3) & Live Station Attendance (Menu 4)
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<
    "ALL" | "Verified" | "Pending" | "Discrepancy"
  >("Verified");
  const [stationWorkingFilter, setStationWorkingFilter] =
    useState<StationWorkingFilter>("ALL");

  // Station-Wise vs Operator-Wise Grouping Mode & Mandatory Download Gate Checkbox
  const [reportGroupMode, setReportGroupMode] =
    useState<ReportGroupingMode>("DAILY_LEDGER");
  const [confirmDownloadCheck, setConfirmDownloadCheck] = useState<boolean>(false);

  // Force-Edit / Audit Modal State for Daily Reports (Menu 2)
  const [editingReport, setEditingReport] = useState<any | null>(null);
  const [manualCashOverride, setManualCashOverride] = useState(false);
  const [auditReasonCategory, setAuditReasonCategory] = useState("");
  const [auditOtherText, setAuditOtherText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Admin Late Penalty Waive-Off Modal State (Menu 6 — Requirement #8)
  const [waivingPenalty, setWaivingPenalty] = useState<any | null>(null);
  const [waiveReasonText, setWaiveReasonText] = useState<string>("");
  const [isProcessingWaive, setIsProcessingWaive] = useState<boolean>(false);

  // UIDAI Tariff Master State (Menu 8)
  const [tariffForm, setTariffForm] = useState({
    effective_from: getISTDateString(1),
    new_enrolment_fee: "0",
    mbu_free_fee: "0",
    mbu_chargeable_fee: "125",
    demographic_fee: "75",
    biometric_fee: "125",
    demo_min_threshold: "50",
    demo_max_threshold: "100",
    bio_min_threshold: "100",
    gst_percent: "18",
    daily_late_penalty: "100",
  });
  const [isSavingTariff, setIsSavingTariff] = useState(false);

  const handleNumericWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleNumericKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowUp", "ArrowDown", "e", "E", "+", "-"].includes(e.key)) {
      e.preventDefault();
    }
  };

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setLiveDateDDMMYYYY(formatToDDMMYYYY(getISTDateString(0)));
      setLiveTimeIST(
        now
          .toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          })
          .toUpperCase()
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    setConfirmDownloadCheck(false);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  useEffect(() => {
    initializeAdminAadhaarHub();
  }, [fromDate, toDate]);

  const initializeAdminAadhaarHub = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data: staff } = await supabase
        .from("back_office_staff")
        .select("*")
        .ilike("email", session.user.email || "")
        .maybeSingle();

      if (!staff) return router.push("/login");
      setStaffUser(staff);

      const [
        locRes,
        partRes,
        dailyRes,
        weeklyRes,
        depRes,
        penRes,
        upgRes,
        tarRes,
      ] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"),
        supabase
          .from("active_partners")
          .select(
            "*, locations(id, center_name, center_code, state, dist, parent_master_id, role_aadhaar)"
          )
          .order("partner_name"),
        supabase
          .from("aadhaar_daily_reports")
          .select(
            "*, active_partners(partner_name, locations(id, center_name, center_code, state, parent_master_id, role_aadhaar))"
          )
          .gte("report_date", fromDate)
          .lte("report_date", toDate)
          .order("report_date", { ascending: false }),
        supabase
          .from("aadhaar_weekly_reports")
          .select(
            "*, active_partners(partner_name, locations(id, center_name, center_code, state, parent_master_id, role_aadhaar))"
          )
          .order("end_date", { ascending: false }),
        supabase
          .from("partner_deposits")
          .select(
            "*, active_partners(id, partner_name, aadhaar_operator_id, aadhaar_station_id, locations(id, center_name, center_code, state, parent_master_id, role_aadhaar))"
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("aadhaar_penalty_logs")
          .select(
            "*, active_partners(partner_name, aadhaar_operator_id, aadhaar_station_id, locations(id, center_name, center_code, state, parent_master_id, role_aadhaar))"
          )
          .order("penalty_for_date", { ascending: false }),
        supabase
          .from("partner_upgrade_requests")
          .select(
            "*, active_partners(partner_name, email, mobile, center_id, locations(center_name, center_code, state, role_aadhaar))"
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("aadhaar_tariff_history")
          .select("*")
          .order("effective_from", { ascending: false }),
      ]);

      const allDeps = depRes.data || [];
      const onlyAadhaarDeps = allDeps.filter(
        (d: any) =>
          d.deposit_stream === "AADHAAR" ||
          String(d.reference_no || "")
            .toUpperCase()
            .startsWith("AADHAAR_")
      );

      setLocations(locRes.data || []);
      setPartners(partRes.data || []);
      setDailyReports(dailyRes.data || []);
      setWeeklyReports(weeklyRes.data || []);
      setAadhaarDeposits(onlyAadhaarDeps);
      setPenaltyLogs(penRes.data || []);
      setUpgradeRequests(upgRes.data || []);
      setTariffHistory(tarRes.data || []);
    } catch (err: any) {
      await reportAndMaskError(err, "ADMIN_AADHAAR_INIT");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // STRICT AADHAAR-MAPPED 5-TIER CASCADING FILTER ENGINE
  // =========================================================================
  const aadhaarEnabledCenters = useMemo(
    () => locations.filter((l) => !l.is_master_node && l.role_aadhaar === true),
    [locations]
  );

  const uniqueStates = useMemo(
    () =>
      Array.from(
        new Set(aadhaarEnabledCenters.map((l) => l.state).filter(Boolean))
      ).sort(),
    [aadhaarEnabledCenters]
  );

  const hqOptions = useMemo(() => {
    const validHqIds = new Set(
      aadhaarEnabledCenters
        .filter((c) => fState === "ALL" || c.state === fState)
        .map((c) => c.parent_master_id)
        .filter(Boolean)
    );
    return locations.filter((l) => l.is_master_node && validHqIds.has(l.id));
  }, [locations, aadhaarEnabledCenters, fState]);

  const centerOptions = useMemo(
    () =>
      aadhaarEnabledCenters.filter(
        (l) =>
          (fState === "ALL" || l.state === fState) &&
          (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
      ),
    [aadhaarEnabledCenters, fState, fHq]
  );

  const stationOptions = useMemo(() => {
    const stnMap = new Map<
      string,
      { station_id: string; center_code: string; operatorCount: number }
    >();

    partners.forEach((p) => {
      if (!p.aadhaar_station_id) return;
      const loc = p.locations;
      if (!loc || !loc.role_aadhaar) return;
      if (fState !== "ALL" && loc.state !== fState) return;
      if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq) return;
      if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return;

      const existing = stnMap.get(p.aadhaar_station_id);
      if (existing) {
        existing.operatorCount += 1;
      } else {
        stnMap.set(p.aadhaar_station_id, {
          station_id: p.aadhaar_station_id,
          center_code: loc.center_code || "NO-CODE",
          operatorCount: 1,
        });
      }
    });

    dailyReports.forEach((r) => {
      if (!r.station_id) return;
      const loc = r.active_partners?.locations;
      if (!loc || !loc.role_aadhaar) return;
      if (fState !== "ALL" && loc.state !== fState) return;
      if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq) return;
      if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return;

      if (!stnMap.has(r.station_id)) {
        stnMap.set(r.station_id, {
          station_id: r.station_id,
          center_code: loc.center_code || "NO-CODE",
          operatorCount: 1,
        });
      }
    });

    return Array.from(stnMap.values()).sort((a, b) =>
      a.station_id.localeCompare(b.station_id)
    );
  }, [partners, dailyReports, fState, fHq, fCenter]);

  const operatorOptions = useMemo(
    () =>
      partners.filter((p) => {
        if (!p.role_aadhaar || !p.aadhaar_operator_id || !p.aadhaar_station_id)
          return false;
        const loc = p.locations;
        if (!loc || !loc.role_aadhaar) return false;
        if (fState !== "ALL" && loc.state !== fState) return false;
        if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq) return false;
        if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return false;
        if (fStation !== "ALL" && p.aadhaar_station_id !== fStation) return false;
        return true;
      }),
    [partners, fState, fHq, fCenter, fStation]
  );

  const matchesCascade = (
    partnerId: string,
    locObj: any,
    rowStationId?: string
  ) => {
    if (!locObj?.role_aadhaar) return false;
    if (fState !== "ALL" && locObj?.state !== fState) return false;
    if (fHq !== "ALL" && locObj?.parent_master_id?.toString() !== fHq)
      return false;
    if (fCenter !== "ALL" && locObj?.id?.toString() !== fCenter) return false;
    if (fStation !== "ALL" && rowStationId !== fStation) return false;
    if (fPartner !== "ALL" && partnerId !== fPartner) return false;
    return true;
  };

  const filteredDailyReports = useMemo(() => {
    return dailyReports.filter((r) => {
      const loc = r.active_partners?.locations;
      if (!matchesCascade(r.partner_id, loc, r.station_id)) return false;
      if (fFileMode === "WITH_FILES" && !r.has_files) return false;
      if (fFileMode === "WITHOUT_FILES" && r.has_files) return false;
      return true;
    });
  }, [dailyReports, fState, fHq, fCenter, fStation, fPartner, fFileMode]);

  const filteredWeeklyReports = useMemo(() => {
    return weeklyReports.filter((w) =>
      matchesCascade(w.partner_id, w.active_partners?.locations, w.station_id)
    );
  }, [weeklyReports, fState, fHq, fCenter, fStation, fPartner]);

  const filteredPenalties = useMemo(() => {
    return penaltyLogs.filter((p) =>
      matchesCascade(
        p.partner_id,
        p.active_partners?.locations,
        p.active_partners?.aadhaar_station_id
      )
    );
  }, [penaltyLogs, fState, fHq, fCenter, fStation, fPartner]);

  // REQUIREMENT #7: Filtered Aadhaar Collections & Remittances (Date + 5-Tier Cascade + Status)
  const filteredDepositsAllStatuses = useMemo(() => {
    return aadhaarDeposits.filter((d) => {
      const dt = (d.deposit_date || d.created_at || "").split("T")[0];
      if (dt < fromDate || dt > toDate) return false;
      const loc = d.active_partners?.locations;
      const stn = d.active_partners?.aadhaar_station_id;
      return matchesCascade(d.partner_id, loc, stn);
    });
  }, [aadhaarDeposits, fromDate, toDate, fState, fHq, fCenter, fStation, fPartner]);

  const filteredDepositsForTable = useMemo(() => {
    return filteredDepositsAllStatuses.filter((d) => {
      if (collectionStatusFilter === "ALL") return true;
      if (collectionStatusFilter === "Pending") {
        return String(d.status || "").includes("Pending");
      }
      return d.status === collectionStatusFilter;
    });
  }, [filteredDepositsAllStatuses, collectionStatusFilter]);

  // REQUIREMENT #10: Live Working vs. Absent / Leave / Non-Working Stations Matrix
  const liveStationAttendanceMatrix = useMemo(() => {
    return operatorOptions.map((op) => {
      const opReports = filteredDailyReports.filter((r) => r.partner_id === op.id);
      const latestRep = opReports[0] || null;

      let statusCategory: StationWorkingFilter = "NON_WORKING_UNLOGGED";
      let statusBadge = "🔴 Non-Working (No Report Logged)";

      if (latestRep) {
        if (latestRep.has_files || Number(latestRep.total_packets_qty || 0) > 0) {
          statusCategory = "WORKING";
          statusBadge = `🟢 Live Working (${latestRep.total_packets_qty} Pkts)`;
        } else if (latestRep.exemption_reason === "OPERATOR_LEAVE") {
          statusCategory = "LEAVE_ABSENT";
          statusBadge = "🟡 Partner Absent / On Leave";
        } else if (
          latestRep.exemption_reason === "SERVER_L1_DOWN" ||
          latestRep.exemption_reason === "POWER_NETWORK_OUTAGE" ||
          latestRep.exemption_reason === "ECMP_CRASH_MANUAL"
        ) {
          statusCategory = "TECH_OUTAGE";
          statusBadge = `🟠 Non-Working (${latestRep.exemption_reason})`;
        } else if (latestRep.exemption_reason === "CENTER_HOLIDAY") {
          statusCategory = "HOLIDAY";
          statusBadge = "🔵 Center Holiday / Closed";
        }
      }

      const workingDaysCount = opReports.filter(
        (r) => r.has_files || Number(r.total_packets_qty || 0) > 0
      ).length;
      const leaveDaysCount = opReports.filter(
        (r) => r.exemption_reason === "OPERATOR_LEAVE"
      ).length;
      const outageDaysCount = opReports.filter(
        (r) =>
          r.exemption_reason === "SERVER_L1_DOWN" ||
          r.exemption_reason === "POWER_NETWORK_OUTAGE"
      ).length;
      const totalPacketsInWindow = opReports.reduce(
        (s, r) => s + Number(r.total_packets_qty || 0),
        0
      );
      const totalCashInWindow = opReports.reduce(
        (s, r) => s + Number(r.total_cash_collected || 0),
        0
      );

      return {
        partner_id: op.id,
        partner_name: op.partner_name,
        mobile: op.mobile || "N/A",
        operator_id: op.aadhaar_operator_id,
        station_id: op.aadhaar_station_id,
        center_code: op.locations?.center_code || "NO-CODE",
        center_name: op.locations?.center_name || "Unassigned",
        state: op.locations?.state || "N/A",
        statusCategory,
        statusBadge,
        latestReportDate: latestRep
          ? formatToDDMMYYYY(latestRep.report_date)
          : "No Submission",
        workingDaysCount,
        leaveDaysCount,
        outageDaysCount,
        totalPacketsInWindow,
        totalCashInWindow,
      };
    });
  }, [operatorOptions, filteredDailyReports]);

  const visibleStationAttendance = useMemo(() => {
    if (stationWorkingFilter === "ALL") return liveStationAttendanceMatrix;
    return liveStationAttendanceMatrix.filter(
      (row) => row.statusCategory === stationWorkingFilter
    );
  }, [liveStationAttendanceMatrix, stationWorkingFilter]);

  // =========================================================================
  // STATION-WISE & OPERATOR-WISE CONSOLIDATED AGGREGATION MATRICES
  // =========================================================================
  const stationWiseMatrix = useMemo(() => {
    const map: Record<string, any> = {};
    filteredDailyReports.forEach((r) => {
      const stn = r.station_id || "UNMAPPED";
      const loc = r.active_partners?.locations;
      if (!map[stn]) {
        map[stn] = {
          station_id: stn,
          center_code: loc?.center_code || "NO-CODE",
          center_name: loc?.center_name || "Unassigned",
          state: loc?.state || "N/A",
          operatorsSet: new Set<string>(),
          reportsCount: 0,
          cat1: 0,
          cat2: 0,
          cat3: 0,
          cat4: 0,
          cat5: 0,
          totalPkts: 0,
          completed: 0,
          rejected: 0,
          baseAmt: 0,
          gstAmt: 0,
          totalCash: 0,
        };
      }
      if (r.operator_id) map[stn].operatorsSet.add(r.operator_id);
      map[stn].reportsCount += 1;
      map[stn].cat1 += Number(r.cat1_new_qty || 0);
      map[stn].cat2 += Number(r.cat2_mbu_free_qty || 0);
      map[stn].cat3 += Number(r.cat3_mbu_chargeable_qty || 0);
      map[stn].cat4 += Number(r.cat4_demographic_qty || 0);
      map[stn].cat5 += Number(r.cat5_biometric_qty || 0);
      map[stn].totalPkts += Number(r.total_packets_qty || 0);
      map[stn].completed += Number(r.completed_qty || 0);
      map[stn].rejected += Number(r.rejected_qty || 0);
      map[stn].baseAmt += Number(r.base_amount || 0);
      map[stn].gstAmt += Number(r.gst_amount || 0);
      map[stn].totalCash += Number(r.total_cash_collected || 0);
    });

    return Object.values(map).map((item: any) => ({
      ...item,
      operatorsList: Array.from(item.operatorsSet),
    }));
  }, [filteredDailyReports]);

  const operatorWiseMatrix = useMemo(() => {
    const map: Record<string, any> = {};
    filteredDailyReports.forEach((r) => {
      const key = `${r.operator_id || "NO-OP"}_${r.station_id || "NO-STN"}`;
      const loc = r.active_partners?.locations;
      if (!map[key]) {
        map[key] = {
          key,
          operator_id: r.operator_id || "UNMAPPED",
          station_id: r.station_id || "UNMAPPED",
          partner_name: r.active_partners?.partner_name || "Unknown",
          center_code: loc?.center_code || "NO-CODE",
          center_name: loc?.center_name || "Unassigned",
          daysLogged: 0,
          cat1: 0,
          cat2: 0,
          cat3: 0,
          cat4: 0,
          cat5: 0,
          totalPkts: 0,
          rejected: 0,
          totalCash: 0,
        };
      }
      map[key].daysLogged += 1;
      map[key].cat1 += Number(r.cat1_new_qty || 0);
      map[key].cat2 += Number(r.cat2_mbu_free_qty || 0);
      map[key].cat3 += Number(r.cat3_mbu_chargeable_qty || 0);
      map[key].cat4 += Number(r.cat4_demographic_qty || 0);
      map[key].cat5 += Number(r.cat5_biometric_qty || 0);
      map[key].totalPkts += Number(r.total_packets_qty || 0);
      map[key].rejected += Number(r.rejected_qty || 0);
      map[key].totalCash += Number(r.total_cash_collected || 0);
    });

    return Object.values(map);
  }, [filteredDailyReports]);

  const missingTodayOperators = useMemo(() => {
    const submittedPartnerIds = new Set(
      dailyReports.filter((r) => r.report_date === toDate).map((r) => r.partner_id)
    );
    return operatorOptions.filter((op) => !submittedPartnerIds.has(op.id));
  }, [operatorOptions, dailyReports, toDate]);

  const pendingCorrectionCount = useMemo(
    () =>
      filteredDailyReports.filter((r) => r.edit_request_status === "Pending")
        .length,
    [filteredDailyReports]
  );

  const kpi = useMemo(() => {
    return filteredDailyReports.reduce(
      (acc, r) => {
        acc.cat1 += Number(r.cat1_new_qty || 0);
        acc.cat2 += Number(r.cat2_mbu_free_qty || 0);
        acc.cat3 += Number(r.cat3_mbu_chargeable_qty || 0);
        acc.cat4 += Number(r.cat4_demographic_qty || 0);
        acc.cat5 += Number(r.cat5_biometric_qty || 0);
        acc.pkts += Number(r.total_packets_qty || 0);
        acc.comp += Number(r.completed_qty || 0);
        acc.inproc += Number(r.inprocess_qty || 0);
        acc.rej += Number(r.rejected_qty || 0);
        acc.base += Number(r.base_amount || 0);
        acc.gst += Number(r.gst_amount || 0);
        acc.cash += Number(r.total_cash_collected || 0);
        return acc;
      },
      {
        cat1: 0,
        cat2: 0,
        cat3: 0,
        cat4: 0,
        cat5: 0,
        pkts: 0,
        comp: 0,
        inproc: 0,
        rej: 0,
        base: 0,
        gst: 0,
        cash: 0,
      }
    );
  }, [filteredDailyReports]);

  const collectionKpi = useMemo(() => {
    const approvedSum = filteredDepositsAllStatuses
      .filter((d) => d.status === "Verified")
      .reduce((s, d) => s + Number(d.deposit_amount || 0), 0);
    const pendingSum = filteredDepositsAllStatuses
      .filter((d) => String(d.status || "").includes("Pending"))
      .reduce((s, d) => s + Number(d.deposit_amount || 0), 0);
    const discrepancySum = filteredDepositsAllStatuses
      .filter((d) => d.status === "Discrepancy")
      .reduce((s, d) => s + Number(d.deposit_amount || 0), 0);
    const activePenSum = filteredPenalties
      .filter((p) => !p.is_settled && !p.is_waived)
      .reduce((s, p) => s + Number(p.penalty_amount || 0), 0);

    const netBalancePayable = Math.max(
      0,
      kpi.cash + activePenSum - (approvedSum + pendingSum)
    );

    return {
      approvedSum,
      pendingSum,
      discrepancySum,
      activePenSum,
      netBalancePayable,
    };
  }, [filteredDepositsAllStatuses, filteredPenalties, kpi.cash]);

  // =========================================================================
  // EXPORT ENGINES: STATION/OPERATOR CSV, COLLECTIONS CSV & ATTENDANCE CSV
  // =========================================================================
  const handleExportStationOrOperatorSummaryCSV = () => {
    if (!confirmDownloadCheck || filteredDailyReports.length === 0) return;

    if (reportGroupMode === "STATION_WISE") {
      const headers = [
        "Window",
        "UIDAI Station ID",
        "Center Code",
        "Center Name",
        "State",
        "Active Operators on Station",
        "Total Reports Logged",
        "1. New (Free)",
        "2. MBU (Free)",
        "3. MBU (Paid)",
        "4. Demographic",
        "5. Biometric",
        "Total Packets",
        "Rejected Packets",
        "Base Fee (INR)",
        "18% GST (INR)",
        "Total Cash Collected (INR)",
      ];
      const rows = stationWiseMatrix.map((s: any) =>
        [
          `"${formatToDDMMYYYY(fromDate)} to ${formatToDDMMYYYY(toDate)}"`,
          `"${s.station_id}"`,
          `"${s.center_code}"`,
          `"${s.center_name}"`,
          `"${s.state}"`,
          `"${s.operatorsList.join(" | ")}"`,
          s.reportsCount,
          s.cat1,
          s.cat2,
          s.cat3,
          s.cat4,
          s.cat5,
          s.totalPkts,
          s.rejected,
          s.baseAmt.toFixed(2),
          s.gstAmt.toFixed(2),
          s.totalCash.toFixed(2),
        ].join(",")
      );
      const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `FastArk_Aadhaar_STATION_WISE_${fStation}_${formatToDDMMYYYY(
        fromDate
      ).replace(/\//g, "-")}.csv`;
      link.click();
    } else {
      const headers = [
        "Window",
        "UIDAI Operator ID",
        "UIDAI Station ID",
        "Operator Name",
        "Center Code",
        "Center Name",
        "Days Logged",
        "1. New (Free)",
        "2. MBU (Free)",
        "3. MBU (Paid)",
        "4. Demographic",
        "5. Biometric",
        "Total Packets",
        "Rejected Packets",
        "Total Cash Collected (INR)",
      ];
      const rows = operatorWiseMatrix.map((o: any) =>
        [
          `"${formatToDDMMYYYY(fromDate)} to ${formatToDDMMYYYY(toDate)}"`,
          `"${o.operator_id}"`,
          `"${o.station_id}"`,
          `"${o.partner_name}"`,
          `"${o.center_code}"`,
          `"${o.center_name}"`,
          o.daysLogged,
          o.cat1,
          o.cat2,
          o.cat3,
          o.cat4,
          o.cat5,
          o.totalPkts,
          o.rejected,
          o.totalCash.toFixed(2),
        ].join(",")
      );
      const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `FastArk_Aadhaar_OPERATOR_WISE_${fStation}_${formatToDDMMYYYY(
        fromDate
      ).replace(/\//g, "-")}.csv`;
      link.click();
    }
  };

  const handleExportCollectionsCSV = () => {
    if (filteredDepositsForTable.length === 0)
      return alert("No collection records match the current filters.");

    const headers = [
      "Deposit Date (DD/MM/YYYY)",
      "System Reference Code",
      "State",
      "Center Code",
      "Center Name",
      "Operator Name",
      "UIDAI Operator ID",
      "UIDAI Station ID",
      "Method",
      "Unique UTR No",
      "Transaction ID",
      "Deposit Amount (INR)",
      "Audit Status",
      "Remarks / Exemption",
    ];

    const rows = filteredDepositsForTable.map((d: any) => {
      const loc = d.active_partners?.locations;
      const cleanUtr =
        d.utr_number || String(d.reference_no || "").replace(/^AADHAAR_/i, "");
      const cleanTxn = d.transaction_id || cleanUtr;
      const refCode =
        d.reference_code ||
        `FA-ADH-${String(d.id || "")
          .slice(0, 6)
          .toUpperCase()}`;

      return [
        `"${formatToDDMMYYYY((d.deposit_date || d.created_at || "").split("T")[0])}"`,
        `"${refCode}"`,
        `"${loc?.state || "N/A"}"`,
        `"${loc?.center_code || "NO-CODE"}"`,
        `"${loc?.center_name || "N/A"}"`,
        `"${d.active_partners?.partner_name || "N/A"}"`,
        `"${d.active_partners?.aadhaar_operator_id || "N/A"}"`,
        `"${d.active_partners?.aadhaar_station_id || "N/A"}"`,
        `"${d.deposit_method}"`,
        `"${cleanUtr}"`,
        `"${cleanTxn}"`,
        Number(d.deposit_amount || 0).toFixed(2),
        `"${d.status}"`,
        `"${d.rejection_reason || d.exemption_reason || ""}"`,
      ].join(",");
    });

    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Aadhaar_Collections_${collectionStatusFilter}_${formatToDDMMYYYY(
      fromDate
    ).replace(/\//g, "-")}.csv`;
    link.click();
  };

  const handleExportStationAttendanceCSV = () => {
    if (visibleStationAttendance.length === 0)
      return alert("No stations match the selected status filter.");

    const headers = [
      "Window",
      "State",
      "Center Code",
      "Center Name",
      "UIDAI Station ID",
      "UIDAI Operator ID",
      "Operator Name",
      "Mobile",
      "Live Station Status",
      "Latest Report Date",
      "Working Days (Period)",
      "Leave / Absent Days",
      "Tech Outage Days",
      "Total Packets Logged",
      "Total Cash Collected (INR)",
    ];

    const rows = visibleStationAttendance.map((s) =>
      [
        `"${formatToDDMMYYYY(fromDate)} to ${formatToDDMMYYYY(toDate)}"`,
        `"${s.state}"`,
        `"${s.center_code}"`,
        `"${s.center_name}"`,
        `"${s.station_id}"`,
        `"${s.operator_id}"`,
        `"${s.partner_name}"`,
        `"${s.mobile}"`,
        `"${s.statusBadge}"`,
        `"${s.latestReportDate}"`,
        s.workingDaysCount,
        s.leaveDaysCount,
        s.outageDaysCount,
        s.totalPacketsInWindow,
        s.totalCashInWindow.toFixed(2),
      ].join(",")
    );

    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Aadhaar_Station_Status_${stationWorkingFilter}_${formatToDDMMYYYY(
      toDate
    ).replace(/\//g, "-")}.csv`;
    link.click();
  };

  // =========================================================================
  // ACTIONS: FILE DOWNLOAD, REPORT FORCE-EDIT, PENALTY WAIVE-OFF & TARIFF
  // =========================================================================
  const handleDownloadVaultFile = async (
    path: string | null,
    bucket = "aadhaar-reports"
  ) => {
    if (!path) return alert("No file attached (Manual / Exemption record).");
    if (path.startsWith("http")) {
      window.open(path, "_blank");
      return;
    }
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 120);
    if (error || !data?.signedUrl)
      return alert("[ERR-VLT-301] Failed to generate secure download link.");
    window.open(data.signedUrl, "_blank");
  };

  // REQUIREMENT #8: Admin Late Payment Penalty Waive-Off Execution
  const handleConfirmPenaltyWaiveOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waivingPenalty) return;
    if (waiveReasonText.trim().length < 5) {
      return alert(
        "Please provide a detailed waive-off reason (minimum 5 characters)."
      );
    }

    setIsProcessingWaive(true);
    try {
      const cleanReason = waiveReasonText.trim().toUpperCase();
      const nowIso = new Date().toISOString();

      const { error: richWaiveErr } = await supabase
        .from("aadhaar_penalty_logs")
        .update({
          is_waived: true,
          is_settled: true,
          waived_by: staffUser?.auth_id || null,
          waived_by_email: staffUser?.email || "ADMIN",
          waived_at: nowIso,
          waive_reason: cleanReason,
        })
        .eq("id", waivingPenalty.id);

      if (richWaiveErr && richWaiveErr.code === "42703") {
        // Fallback if SQL migration hasn't been executed yet
        const { error: fbErr } = await supabase
          .from("aadhaar_penalty_logs")
          .update({ is_settled: true })
          .eq("id", waivingPenalty.id);
        if (fbErr) throw fbErr;
      } else if (richWaiveErr) {
        throw richWaiveErr;
      }

      await Promise.all([
        supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser?.id || "ADMIN",
            staff_email: staffUser?.email,
            action_type: "PENALTY_WAIVE_OFF",
            module: "AADHAAR_HUB",
            target_id: waivingPenalty.id,
            details: `Waived off ₹${waivingPenalty.penalty_amount} late penalty (${formatToDDMMYYYY(
              waivingPenalty.penalty_for_date
            )}) for ${
              waivingPenalty.active_partners?.partner_name
            } (Stn: ${
              waivingPenalty.active_partners?.aadhaar_station_id
            }). Reason: ${cleanReason}`,
          },
        ]),
        logSystemTelemetry({
          actorId: staffUser?.id,
          actorEmail: staffUser?.email,
          actorRole: staffUser?.role || "Admin",
          module: "ADMIN_AADHAAR_PENALTY",
          actionCode: "PENALTY_WAIVED_OFF",
          referenceId: waivingPenalty.id,
          metadata: {
            partner_id: waivingPenalty.partner_id,
            penalty_for_date: waivingPenalty.penalty_for_date,
            amount: waivingPenalty.penalty_amount,
            waive_reason: cleanReason,
          },
        }),
        supabase.from("partner_messages").insert([
          {
            partner_id: waivingPenalty.partner_id,
            subject: `✅ Late Payment Penalty Waived Off (₹${waivingPenalty.penalty_amount})`,
            body: `Your late payment penalty of ₹${
              waivingPenalty.penalty_amount
            } for Aadhaar report date ${formatToDDMMYYYY(
              waivingPenalty.report_date
            )} (Penalty Date: ${formatToDDMMYYYY(
              waivingPenalty.penalty_for_date
            )}) has been waived off by Corporate Admin (${
              staffUser?.email
            }). Reason: ${cleanReason}. Your payable balance has been updated.`,
          },
        ]),
      ]);

      alert("✅ Late payment penalty waived off and permanently recorded!");
      setWaivingPenalty(null);
      setWaiveReasonText("");
      await initializeAdminAadhaarHub();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "ADMIN_PENALTY_WAIVE", {
        id: staffUser?.id,
        email: staffUser?.email,
        role: staffUser?.role,
      });
      alert(safeMsg);
    } finally {
      setIsProcessingWaive(false);
    }
  };

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

  const openReportEditModal = (r: any) => {
    setEditingReport({
      ...r,
      cat1_new_qty: Number(r.cat1_new_qty || 0),
      cat2_mbu_free_qty: Number(r.cat2_mbu_free_qty || 0),
      cat3_mbu_chargeable_qty: Number(r.cat3_mbu_chargeable_qty || 0),
      cat4_demographic_qty: Number(r.cat4_demographic_qty || 0),
      cat5_biometric_qty: Number(r.cat5_biometric_qty || 0),
      completed_qty: Number(r.completed_qty || 0),
      inprocess_qty: Number(r.inprocess_qty || 0),
      rejected_qty: Number(r.rejected_qty || 0),
      total_cash_collected: Number(r.total_cash_collected || 0),
      deposit_status: r.deposit_status || "Pending Deposit",
    });
    setManualCashOverride(false);
    setAuditReasonCategory("");
    setAuditOtherText("");
  };

  const handleEditCategoryQty = (field: string, val: string) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setEditingReport((prev: any) => {
      const next = { ...prev, [field]: num };
      if (!manualCashOverride) {
        const tariff = getTariffForDate(next.report_date);
        next.total_cash_collected =
          Number(next.cat3_mbu_chargeable_qty || 0) *
            Number(tariff.mbu_chargeable_fee || 125) +
          Number(next.cat4_demographic_qty || 0) *
            Number(tariff.demographic_fee || 75) +
          Number(next.cat5_biometric_qty || 0) *
            Number(tariff.biometric_fee || 125);
      }
      return next;
    });
  };

  const handleSaveReportEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReport || !auditReasonCategory)
      return alert("Please select a Correction Reason.");
    if (auditReasonCategory === "Other" && auditOtherText.trim().length < 5) {
      return alert("Please enter detailed remarks for 'Other' corrections.");
    }
    if (
      !confirm(
        "Overwrite this Aadhaar Daily Report? This audit action will be logged."
      )
    )
      return;

    setIsSavingEdit(true);
    try {
      const finalRemarks =
        auditReasonCategory === "Other"
          ? `OTHER: ${auditOtherText}`
          : `CORRECTION: ${auditReasonCategory}`;
      const tariff = getTariffForDate(editingReport.report_date);
      const totalPackets =
        Number(editingReport.cat1_new_qty || 0) +
        Number(editingReport.cat2_mbu_free_qty || 0) +
        Number(editingReport.cat3_mbu_chargeable_qty || 0) +
        Number(editingReport.cat4_demographic_qty || 0) +
        Number(editingReport.cat5_biometric_qty || 0);

      const finalCash = Number(editingReport.total_cash_collected || 0);
      const gstPct = Number(tariff.gst_percent || 18);
      const finalBase = Number((finalCash / (1 + gstPct / 100)).toFixed(2));
      const finalGst = Number((finalCash - finalBase).toFixed(2));

      const basePayload: any = {
        cat1_new_qty: Number(editingReport.cat1_new_qty || 0),
        cat2_mbu_free_qty: Number(editingReport.cat2_mbu_free_qty || 0),
        cat3_mbu_chargeable_qty: Number(editingReport.cat3_mbu_chargeable_qty || 0),
        cat4_demographic_qty: Number(editingReport.cat4_demographic_qty || 0),
        cat5_biometric_qty: Number(editingReport.cat5_biometric_qty || 0),
        total_packets_qty: totalPackets,
        completed_qty: Number(editingReport.completed_qty || 0),
        inprocess_qty: Number(editingReport.inprocess_qty || 0),
        rejected_qty: Number(editingReport.rejected_qty || 0),
        base_amount: finalBase,
        gst_amount: finalGst,
        total_cash_collected: finalCash,
        exemption_reason: finalRemarks,
        deposit_status:
          finalCash === 0 ? "Settled" : editingReport.deposit_status,
      };

      const { error: richErr } = await supabase
        .from("aadhaar_daily_reports")
        .update({
          ...basePayload,
          is_edited_by_staff: true,
          staff_edit_remarks: finalRemarks,
          edited_at: new Date().toISOString(),
          edit_request_status: null,
          edit_request_reason: null,
        })
        .eq("id", editingReport.id);

      if (richErr) {
        const { error: fallbackErr } = await supabase
          .from("aadhaar_daily_reports")
          .update(basePayload)
          .eq("id", editingReport.id);
        if (fallbackErr) throw fallbackErr;
      }

      await Promise.all([
        supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser?.id || "ADMIN",
            staff_email: staffUser?.email,
            action_type: "AUDIT",
            module: "AADHAAR_HUB",
            target_id: editingReport.id,
            details: `Edited Aadhaar Daily Report (${formatToDDMMYYYY(
              editingReport.report_date
            )}) for ${editingReport.active_partners?.partner_name} (Op: ${
              editingReport.operator_id
            }, Stn: ${
              editingReport.station_id
            }). Packets: ${totalPackets}, Cash: ₹${finalCash}. Reason: ${finalRemarks}`,
          },
        ]),
        logSystemTelemetry({
          actorId: staffUser?.id,
          actorEmail: staffUser?.email,
          actorRole: staffUser?.role || "Admin",
          module: "ADMIN_AADHAAR_EDIT",
          actionCode: "REPORT_OVERWRITTEN",
          referenceId: editingReport.id,
          metadata: {
            packets: totalPackets,
            cash: finalCash,
            reason: finalRemarks,
          },
        }),
        supabase.from("partner_messages").insert([
          {
            partner_id: editingReport.partner_id,
            subject: `🆔 Aadhaar Report Audited: ${formatToDDMMYYYY(
              editingReport.report_date
            )}`,
            body: `Your Aadhaar report for ${formatToDDMMYYYY(
              editingReport.report_date
            )} (Station ${
              editingReport.station_id
            }) was updated by Admin (Packets: ${totalPackets}, Cash: ₹${finalCash.toLocaleString(
              "en-IN"
            )}). Reason: ${finalRemarks}.`,
          },
        ]),
      ]);

      alert("✅ Aadhaar Daily Report updated and audited!");
      setEditingReport(null);
      initializeAdminAadhaarHub();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "ADMIN_AADHAAR_EDIT", {
        id: staffUser?.id,
        email: staffUser?.email,
      });
      alert(safeMsg);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDismissCorrectionRequest = async (reportId: string) => {
    if (
      !confirm(
        "Dismiss this partner's correction request without changing the report numbers?"
      )
    )
      return;
    try {
      await supabase
        .from("aadhaar_daily_reports")
        .update({ edit_request_status: "Rejected", edit_request_reason: null })
        .eq("id", reportId);
      initializeAdminAadhaarHub();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "ADMIN_DISMISS_REQ");
      alert(safeMsg);
    }
  };

  const handleCreateNewTariffVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((staffUser?.role || "").toLowerCase() !== "admin") {
      return alert("Forbidden: Only Super Admins can modify UIDAI Tariff rates.");
    }
    if (
      !confirm(
        `Deploy new UIDAI Tariff effective from ${formatToDDMMYYYY(
          tariffForm.effective_from
        )}? All reports prior to this date will remain locked at their historical rates.`
      )
    )
      return;

    setIsSavingTariff(true);
    try {
      const effDate = new Date(`${tariffForm.effective_from}T00:00:00Z`);
      effDate.setUTCDate(effDate.getUTCDate() - 1);
      const prevCloseDate = effDate.toISOString().split("T")[0];

      await supabase
        .from("aadhaar_tariff_history")
        .update({ effective_to: prevCloseDate })
        .is("effective_to", null);

      const { error } = await supabase.from("aadhaar_tariff_history").insert([
        {
          effective_from: tariffForm.effective_from,
          effective_to: null,
          new_enrolment_fee: parseFloat(tariffForm.new_enrolment_fee) || 0,
          mbu_free_fee: parseFloat(tariffForm.mbu_free_fee) || 0,
          mbu_chargeable_fee: parseFloat(tariffForm.mbu_chargeable_fee) || 125,
          demographic_fee: parseFloat(tariffForm.demographic_fee) || 75,
          biometric_fee: parseFloat(tariffForm.biometric_fee) || 125,
          demo_min_threshold: parseFloat(tariffForm.demo_min_threshold) || 50,
          demo_max_threshold: parseFloat(tariffForm.demo_max_threshold) || 100,
          bio_min_threshold: parseFloat(tariffForm.bio_min_threshold) || 100,
          gst_percent: parseFloat(tariffForm.gst_percent) || 18,
          daily_late_penalty: parseFloat(tariffForm.daily_late_penalty) || 100,
          created_by: staffUser?.auth_id || null,
        },
      ]);

      if (error) throw error;

      await logSystemTelemetry({
        actorId: staffUser?.id,
        actorEmail: staffUser?.email,
        actorRole: staffUser?.role,
        module: "ADMIN_TARIFF_MASTER",
        actionCode: "NEW_TARIFF_DEPLOYED",
        referenceId: tariffForm.effective_from,
      });

      alert(
        `✅ New UIDAI Tariff version activated from ${formatToDDMMYYYY(
          tariffForm.effective_from
        )}!`
      );
      initializeAdminAadhaarHub();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "ADMIN_TARIFF_SAVE");
      alert(safeMsg);
    } finally {
      setIsSavingTariff(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-black text-xs uppercase tracking-widest animate-pulse">
        Loading Corporate Aadhaar Command Hub...
      </div>
    );
  }

  const isSuperAdmin = (staffUser?.role || "").trim().toLowerCase() === "admin";
  const unpaidPenaltiesSum = filteredPenalties
    .filter((p) => !p.is_settled && !p.is_waived)
    .reduce((s, p) => s + Number(p.penalty_amount || 0), 0);
  const waivedPenaltiesSum = filteredPenalties
    .filter((p) => p.is_waived)
    .reduce((s, p) => s + Number(p.penalty_amount || 0), 0);

  const selectedOperatorObj = operatorOptions.find((op) => op.id === fPartner);
  const exportScopeLabel = `State:${fState} | Center:${fCenter} | Station:${fStation} | Operator:${
    selectedOperatorObj
      ? `${selectedOperatorObj.partner_name} (${selectedOperatorObj.aadhaar_operator_id})`
      : "ALL"
  }`;
  const isExportReady = Boolean(
    fromDate &&
      toDate &&
      filteredDailyReports.length > 0 &&
      confirmDownloadCheck
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row font-sans">
      {/* ===================================================================== */}
      {/* LEFT SIDEBAR NAVIGATION WITH OFFICIAL COMPANY LOGO (REQ #9)           */}
      {/* ===================================================================== */}
      <aside className="w-full lg:w-80 bg-slate-950 text-white flex flex-col justify-between border-r border-slate-800 shrink-0 min-h-screen select-none">
        <div>
          <div className="p-5 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="bg-white px-2.5 py-1.5 rounded-lg flex items-center justify-center shadow shrink-0">
                  <Image
                    src="/logo.png"
                    alt="Fast Ark Logo"
                    width={105}
                    height={32}
                    priority
                    className="object-contain h-7 w-auto"
                  />
                </div>
                <div>
                  <h1 className="font-black text-sm tracking-wide text-white leading-none">
                    AADHAAR COMMAND
                  </h1>
                  <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest mt-1">
                    Corporate Back-Office Hub
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard"
                className="text-[10px] font-black uppercase tracking-widest bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded border border-slate-700 transition"
              >
                &larr; Admin
              </Link>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span>📅</span>
                <span className="font-black text-emerald-400 tracking-wider">
                  {liveDateDDMMYYYY}
                </span>
              </div>
              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2.5">
                <span>🕒</span>
                <span className="font-mono font-bold text-slate-200 text-[11px]">
                  {liveTimeIST}
                </span>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-1.5">
            {[
              {
                id: "overview",
                icon: "📊",
                label: "1. Network KPIs & Counts",
                sub: "Station & Operator Summaries",
              },
              {
                id: "daily_vault",
                icon: "📥",
                label: "2. Daily Reports & Vault",
                sub: "CSV/HTML & Force-Edit Audit",
                badge:
                  pendingCorrectionCount > 0
                    ? `⚠️ ${pendingCorrectionCount} Edit Req`
                    : `${filteredDailyReports.length}`,
              },
              {
                id: "collections",
                icon: "💳",
                label: "3. Approved Collections",
                sub: "Verified Deposits & Balance Due",
                badge: `₹${collectionKpi.approvedSum.toLocaleString("en-IN")}`,
              },
              {
                id: "station_status",
                icon: "📡",
                label: "4. Live Working & Leave",
                sub: "Working vs Absent/Non-Working",
                badge: `${
                  liveStationAttendanceMatrix.filter(
                    (s) => s.statusCategory === "WORKING"
                  ).length
                }/${liveStationAttendanceMatrix.length} Live`,
              },
              {
                id: "weekly_audit",
                icon: "📅",
                label: "5. Weekly vs Daily Audit",
                sub: "Mon–Sun Reconciliation",
                badge: `${
                  filteredWeeklyReports.filter(
                    (w) => w.discrepancy_days_count > 0
                  ).length
                } Flags`,
              },
              {
                id: "penalties",
                icon: "🚨",
                label: "6. Late Penalty & Waive-Off",
                sub: "₹100/Day Overdue & Waive-Off",
                badge: `₹${unpaidPenaltiesSum}`,
              },
              {
                id: "operators",
                icon: "🆔",
                label: "7. Operator Role & IDs",
                sub: "Bind, Allow & Revoke Access",
                badge: `${
                  upgradeRequests.filter((u) => u.status === "Pending").length
                } Req`,
              },
              ...(isSuperAdmin
                ? [
                    {
                      id: "tariff_master",
                      icon: "⚙️",
                      label: "8. UIDAI Tariff Master",
                      sub: "Date-Versioned Pricing",
                    },
                  ]
                : []),
            ].map((item: any) => {
              const isActive = activeMenu === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenu(item.id as AdminAadhaarMenu)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between border ${
                    isActive
                      ? "bg-blue-600 text-white border-blue-500 shadow-lg"
                      : "bg-slate-900/60 text-slate-300 border-slate-800/80 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{item.icon}</span>
                    <div className="truncate">
                      <p className="font-black text-xs uppercase tracking-wider truncate">
                        {item.label}
                      </p>
                      <p
                        className={`text-[10px] font-bold truncate mt-0.5 ${
                          isActive ? "text-blue-200" : "text-slate-500"
                        }`}
                      >
                        {item.sub}
                      </p>
                    </div>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-slate-800 text-amber-400 shrink-0 ml-2">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50 space-y-2">
          <div className="text-[10px] text-slate-400 font-bold flex justify-between">
            <span>Mapped Aadhaar Centers:</span>
            <span className="text-amber-400 font-black">
              {aadhaarEnabledCenters.length}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold flex justify-between">
            <span>Active Station IDs:</span>
            <span className="text-indigo-400 font-black">
              {stationOptions.length}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold flex justify-between">
            <span>Approved Operators:</span>
            <span className="text-white font-black">
              {operatorOptions.length}
            </span>
          </div>
          <div className="text-[10px] text-red-400 font-bold flex justify-between">
            <span>Missing Upload ({formatToDDMMYYYY(toDate)}):</span>
            <span className="font-black">{missingTodayOperators.length}</span>
          </div>
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* RIGHT MAIN WORKSPACE                                                  */}
      {/* ===================================================================== */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6 max-w-[1500px]">
        {/* REQUIREMENT #6: IMPROVED ADMIN AADHAAR FILTER CONSOLE HEADER & DESCRIPTION */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-base text-slate-900 uppercase tracking-wider">
                Aadhaar Seva Kendra — Network Operations, Collection &amp; Station
                Telemetry Console
              </h2>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                Multi-tier real-time command filter across State, Regional Master HQ,
                Aadhaar Kendra Location, UIDAI Machine Station ID, and Operator ID •
                Active Window:{" "}
                <span className="text-blue-600 font-black">
                  {formatToDDMMYYYY(fromDate)}
                </span>{" "}
                to{" "}
                <span className="text-blue-600 font-black">
                  {formatToDDMMYYYY(toDate)}
                </span>{" "}
                •{" "}
                <span className="text-emerald-700 font-black">
                  {centerOptions.length} Center(s) • {stationOptions.length} Station
                  ID(s) • {operatorOptions.length} Operator(s)
                </span>
              </p>
            </div>

            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-[10px] font-black uppercase">
              <button
                type="button"
                onClick={() => setReportGroupMode("DAILY_LEDGER")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  reportGroupMode === "DAILY_LEDGER"
                    ? "bg-slate-900 text-white shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                📋 Daily Ledger ({filteredDailyReports.length})
              </button>
              <button
                type="button"
                onClick={() => setReportGroupMode("STATION_WISE")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  reportGroupMode === "STATION_WISE"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🖥️ Station ID-Wise ({stationWiseMatrix.length})
              </button>
              <button
                type="button"
                onClick={() => setReportGroupMode("OPERATOR_WISE")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  reportGroupMode === "OPERATOR_WISE"
                    ? "bg-emerald-600 text-white shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                👤 Operator-Wise ({operatorWiseMatrix.length})
              </button>
            </div>
          </div>

          {aadhaarEnabledCenters.length === 0 && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-xs font-bold text-amber-900">
              <span>
                ⚠️ No Aadhaar Centers are mapped yet. Enable an Aadhaar Center and
                approve an Operator in Menu 7 to track reports.
              </span>
              <button
                onClick={() => setActiveMenu("operators")}
                className="bg-amber-500 text-slate-950 font-black px-3 py-1.5 rounded-lg text-[10px] uppercase shrink-0"
              >
                Go to Menu 7 &rarr;
              </button>
            </div>
          )}

          {/* ROW 1: 5-TIER GEOGRAPHIC, STATION ID & OPERATOR CASCADE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                1. State (Aadhaar Mapped)
              </label>
              <select
                value={fState}
                onChange={(e) => {
                  setFState(e.target.value);
                  setFHq("ALL");
                  setFCenter("ALL");
                  setFStation("ALL");
                  setFPartner("ALL");
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-600"
              >
                <option value="ALL">
                  All Aadhaar States ({uniqueStates.length})
                </option>
                {uniqueStates.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                2. Master HQ (Aadhaar Mapped)
              </label>
              <select
                value={fHq}
                onChange={(e) => {
                  setFHq(e.target.value);
                  setFCenter("ALL");
                  setFStation("ALL");
                  setFPartner("ALL");
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-600"
              >
                <option value="ALL">All Master HQs ({hqOptions.length})</option>
                {hqOptions.map((hq) => (
                  <option key={hq.id} value={hq.id}>
                    {hq.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-amber-600 mb-1">
                3. Mapped Aadhaar Center [Code]
              </label>
              <select
                value={fCenter}
                onChange={(e) => {
                  setFCenter(e.target.value);
                  setFStation("ALL");
                  setFPartner("ALL");
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-amber-200 p-2.5 rounded-lg text-xs font-black bg-amber-50/50 text-slate-900 outline-none focus:border-amber-500"
              >
                <option value="ALL">
                  All Aadhaar Centers ({centerOptions.length})
                </option>
                {centerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.center_code || "NO-CODE"}] {c.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-indigo-600 mb-1">
                4. UIDAI Station ID (Machine)
              </label>
              <select
                value={fStation}
                onChange={(e) => {
                  setFStation(e.target.value);
                  setFPartner("ALL");
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-indigo-200 p-2.5 rounded-lg text-xs font-black bg-indigo-50/50 text-indigo-950 outline-none focus:border-indigo-600"
              >
                <option value="ALL">
                  All Station IDs ({stationOptions.length})
                </option>
                {stationOptions.map((stn) => (
                  <option key={stn.station_id} value={stn.station_id}>
                    Stn: {stn.station_id} [{stn.center_code}] ({stn.operatorCount} Op
                    {stn.operatorCount > 1 ? "s" : ""})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-emerald-700 mb-1">
                5. Approved Aadhaar Operator
              </label>
              <select
                value={fPartner}
                onChange={(e) => {
                  setFPartner(e.target.value);
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-emerald-200 p-2.5 rounded-lg text-xs font-black bg-emerald-50/50 text-slate-900 outline-none focus:border-emerald-600"
              >
                <option value="ALL">
                  All Operators ({operatorOptions.length})
                </option>
                {operatorOptions.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.partner_name} ({op.aadhaar_operator_id} / Stn:{" "}
                    {op.aadhaar_station_id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ROW 2: 7-OPTION DATE PRESET DROPDOWN + CUSTOM DATES + FILE MODE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-[9px] font-black uppercase text-indigo-600 mb-1">
                6. Date Range Preset (Week / Month / Custom)
              </label>
              <select
                value={datePreset}
                onChange={(e) =>
                  handlePresetChange(e.target.value as DatePresetMode)
                }
                className="w-full border-2 border-indigo-200 p-2.5 rounded-lg text-xs font-black bg-indigo-50 text-indigo-900 outline-none focus:border-indigo-600"
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
                <option value="custom">Custom Filter (Select Dates)</option>
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                From Date ({formatToDDMMYYYY(fromDate)})
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setFromDate(e.target.value);
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                To Date ({formatToDDMMYYYY(toDate)})
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setToDate(e.target.value);
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-blue-600 mb-1">
                7. File Submission Mode
              </label>
              <select
                value={fFileMode}
                onChange={(e) => {
                  setFFileMode(e.target.value as any);
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-blue-200 p-2.5 rounded-lg text-xs font-black bg-blue-50 text-blue-900 outline-none focus:border-blue-600"
              >
                <option value="ALL">📋 Both (With &amp; Without Files)</option>
                <option value="WITH_FILES">
                  ✅ With CSV &amp; HTML Files Only
                </option>
                <option value="WITHOUT_FILES">
                  ⚠️ Without Files (Manual/Exemption)
                </option>
              </select>
            </div>
          </div>

          {/* ROW 3: MANDATORY DOWNLOAD CONFIRMATION CHECKBOX GATE */}
          <div className="pt-3 border-t border-slate-100 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
            <label className="flex items-center gap-2.5 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmDownloadCheck}
                disabled={filteredDailyReports.length === 0}
                onChange={(e) => setConfirmDownloadCheck(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-[11px] font-bold text-slate-800">
                I confirm the selected filter parameters (Station:{" "}
                <strong className="text-indigo-700">{fStation}</strong> | Operator:{" "}
                <strong className="text-emerald-700">
                  {selectedOperatorObj
                    ? selectedOperatorObj.aadhaar_operator_id
                    : "ALL"}
                </strong>{" "}
                | {filteredDailyReports.length} rows) and request report download.
              </span>
            </label>

            <div className="flex flex-wrap gap-2 w-full xl:w-auto">
              <button
                type="button"
                disabled={!isExportReady}
                onClick={() =>
                  downloadAadhaarPDFReport(
                    filteredDailyReports,
                    fFileMode,
                    exportScopeLabel
                  )
                }
                className="flex-1 xl:flex-none bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
              >
                📄 Export Daily PDF
              </button>
              <button
                type="button"
                disabled={!isExportReady}
                onClick={() =>
                  downloadAadhaarCSVReport(
                    filteredDailyReports,
                    `${fFileMode}_Stn_${fStation}`
                  )
                }
                className="flex-1 xl:flex-none bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
              >
                📊 Export Daily CSV
              </button>
              {reportGroupMode !== "DAILY_LEDGER" && (
                <button
                  type="button"
                  disabled={!isExportReady}
                  onClick={handleExportStationOrOperatorSummaryCSV}
                  className="flex-1 xl:flex-none bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                >
                  📑 Export{" "}
                  {reportGroupMode === "STATION_WISE"
                    ? "Station-Wise"
                    : "Operator-Wise"}{" "}
                  CSV
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* STATION-WISE OR OPERATOR-WISE CONSOLIDATED SUMMARY MATRIX             */}
        {/* ===================================================================== */}
        {(activeMenu === "overview" || activeMenu === "daily_vault") &&
          reportGroupMode !== "DAILY_LEDGER" && (
            <div className="bg-white rounded-2xl border-2 border-indigo-200 shadow-sm overflow-hidden animate-in fade-in">
              <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
                <h3 className="font-black text-xs uppercase tracking-widest text-amber-400">
                  {reportGroupMode === "STATION_WISE"
                    ? `🖥️ Consolidated Station ID-Wise Performance Matrix (${stationWiseMatrix.length} Stations)`
                    : `👤 Consolidated Operator-Wise Performance Matrix (${operatorWiseMatrix.length} Operators)`}
                </h3>
                <span className="text-[10px] font-bold text-slate-300">
                  Supports Multiple Operators per Single Station ID
                </span>
              </div>

              <div className="overflow-x-auto">
                {reportGroupMode === "STATION_WISE" ? (
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                      <tr>
                        <th className="p-3.5">UIDAI Station ID</th>
                        <th className="p-3.5">Mapped Center [Code]</th>
                        <th className="p-3.5">Operators Working on Station</th>
                        <th className="p-3.5 text-center">Reports</th>
                        <th className="p-3.5 text-center">New</th>
                        <th className="p-3.5 text-center">MBU(F)</th>
                        <th className="p-3.5 text-center">MBU(P)</th>
                        <th className="p-3.5 text-center">Demo</th>
                        <th className="p-3.5 text-center">Bio</th>
                        <th className="p-3.5 text-center">Total Pkts</th>
                        <th className="p-3.5 text-right">Station Cash (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {stationWiseMatrix.map((s: any) => (
                        <tr key={s.station_id} className="hover:bg-slate-50">
                          <td className="p-3.5 font-black text-indigo-700 text-sm">
                            Stn: {s.station_id}
                          </td>
                          <td className="p-3.5 font-bold text-slate-800">
                            [{s.center_code}] {s.center_name} ({s.state})
                          </td>
                          <td className="p-3.5">
                            <div className="flex flex-wrap gap-1">
                              {s.operatorsList.map((opId: string) => (
                                <span
                                  key={opId}
                                  className="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-black"
                                >
                                  {opId}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-3.5 text-center font-bold">
                            {s.reportsCount}
                          </td>
                          <td className="p-3.5 text-center font-bold">{s.cat1}</td>
                          <td className="p-3.5 text-center font-bold">{s.cat2}</td>
                          <td className="p-3.5 text-center font-bold text-amber-700">
                            {s.cat3}
                          </td>
                          <td className="p-3.5 text-center font-bold text-blue-700">
                            {s.cat4}
                          </td>
                          <td className="p-3.5 text-center font-bold text-purple-700">
                            {s.cat5}
                          </td>
                          <td className="p-3.5 text-center font-black">
                            {s.totalPkts}
                          </td>
                          <td className="p-3.5 text-right font-black text-emerald-700">
                            ₹{s.totalCash.toLocaleString("en-IN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                      <tr>
                        <th className="p-3.5">UIDAI Operator ID</th>
                        <th className="p-3.5">UIDAI Station ID</th>
                        <th className="p-3.5">Operator Name &amp; Center</th>
                        <th className="p-3.5 text-center">Days Logged</th>
                        <th className="p-3.5 text-center">New</th>
                        <th className="p-3.5 text-center">MBU(F)</th>
                        <th className="p-3.5 text-center">MBU(P)</th>
                        <th className="p-3.5 text-center">Demo</th>
                        <th className="p-3.5 text-center">Bio</th>
                        <th className="p-3.5 text-center">Total Pkts</th>
                        <th className="p-3.5 text-right">Operator Cash (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {operatorWiseMatrix.map((o: any) => (
                        <tr key={o.key} className="hover:bg-slate-50">
                          <td className="p-3.5 font-black text-blue-700">
                            {o.operator_id}
                          </td>
                          <td className="p-3.5 font-black text-amber-700">
                            {o.station_id}
                          </td>
                          <td className="p-3.5">
                            <span className="font-black text-slate-900">
                              {o.partner_name}
                            </span>
                            <span className="text-[10px] text-slate-500 font-bold block">
                              [{o.center_code}] {o.center_name}
                            </span>
                          </td>
                          <td className="p-3.5 text-center font-bold">
                            {o.daysLogged}
                          </td>
                          <td className="p-3.5 text-center font-bold">{o.cat1}</td>
                          <td className="p-3.5 text-center font-bold">{o.cat2}</td>
                          <td className="p-3.5 text-center font-bold text-amber-700">
                            {o.cat3}
                          </td>
                          <td className="p-3.5 text-center font-bold text-blue-700">
                            {o.cat4}
                          </td>
                          <td className="p-3.5 text-center font-bold text-purple-700">
                            {o.cat5}
                          </td>
                          <td className="p-3.5 text-center font-black">
                            {o.totalPkts}
                          </td>
                          <td className="p-3.5 text-right font-black text-emerald-700">
                            ₹{o.totalCash.toLocaleString("en-IN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        {/* ===================================================================== */}
        {/* MENU 1: NETWORK KPIS & 5-CATEGORY COUNTS                              */}
        {/* ===================================================================== */}
        {activeMenu === "overview" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">
                  1. New Enrolment
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {kpi.cat1}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-teal-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">
                  2. MBU Free
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {kpi.cat2}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-amber-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">
                  3. MBU Chargeable
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {kpi.cat3}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-blue-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">
                  4. Demographic
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {kpi.cat4}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-purple-600">
                <p className="text-[10px] font-black text-slate-400 uppercase">
                  5. Biometric Update
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {kpi.cat5}
                </p>
              </div>
            </div>

            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl grid grid-cols-2 md:grid-cols-5 gap-6">
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400">
                  Total Network Packets
                </p>
                <p className="text-3xl font-black mt-1">{kpi.pkts}</p>
                <p className="text-[10px] text-emerald-400 font-bold mt-1">
                  ✅ {kpi.comp} Completed | ❌ {kpi.rej} Rejected
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400">
                  Total Cash Collected
                </p>
                <p className="text-2xl font-black mt-1">
                  ₹{kpi.cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  Base: ₹{kpi.base.toLocaleString("en-IN")} + GST: ₹
                  {kpi.gst.toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-emerald-400">
                  Approved Deposits
                </p>
                <p className="text-2xl font-black text-emerald-400 mt-1">
                  ₹
                  {collectionKpi.approvedSum.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <p className="text-[10px] text-amber-300 font-bold mt-1">
                  Pending Verification: ₹
                  {collectionKpi.pendingSum.toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-red-400">
                  Active Late Penalties
                </p>
                <p className="text-2xl font-black text-red-400 mt-1">
                  ₹{unpaidPenaltiesSum.toLocaleString("en-IN")}
                </p>
                <p className="text-[10px] text-emerald-400 font-bold mt-1">
                  Waived Off: ₹{waivedPenaltiesSum.toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-amber-400">
                  Net Balance Payable
                </p>
                <p className="text-3xl font-black text-white mt-1">
                  ₹
                  {collectionKpi.netBalancePayable.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  (Collection + Fines) - Deposits
                </p>
              </div>
            </div>

            {/* MISSING DAILY REPORT DEFAULTERS */}
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
                <h3 className="font-black text-red-800 text-xs uppercase tracking-widest">
                  ⚠️ Approved Operators Missing Daily Upload for{" "}
                  {formatToDDMMYYYY(toDate)}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="bg-red-200 text-red-900 font-black px-2.5 py-0.5 rounded text-xs">
                    {missingTodayOperators.length} Pending
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveMenu("station_status")}
                    className="bg-slate-900 text-white text-[10px] font-black uppercase px-3 py-1 rounded-lg"
                  >
                    Open Live Station Report &rarr;
                  </button>
                </div>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                {missingTodayOperators.length === 0 ? (
                  <p className="col-span-3 text-center py-4 text-xs font-bold text-emerald-600">
                    ✅ All filtered Aadhaar operators have submitted reports for{" "}
                    {formatToDDMMYYYY(toDate)}.
                  </p>
                ) : (
                  missingTodayOperators.map((op) => (
                    <div
                      key={op.id}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex justify-between items-center"
                    >
                      <div>
                        <p className="font-black text-xs text-slate-900">
                          {op.partner_name}
                        </p>
                        <p className="text-[10px] font-bold text-slate-500">
                          [{op.locations?.center_code || "NO-CODE"}]{" "}
                          {op.aadhaar_operator_id} | Stn: {op.aadhaar_station_id}
                        </p>
                      </div>
                      <span className="text-[9px] font-black bg-red-100 text-red-700 px-2 py-1 rounded uppercase">
                        Unlogged
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 2: DAILY REPORTS LEDGER, FILE VAULT & FORCE-EDIT AUDIT           */}
        {/* ===================================================================== */}
        {activeMenu === "daily_vault" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest">
                Daily Aadhaar Reports Vault ({filteredDailyReports.length} Rows)
              </h3>
              <span className="text-[10px] font-bold text-amber-400 uppercase">
                Station: {fStation} | Mode: {fFileMode}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                  <tr>
                    <th className="p-3.5">Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Aadhaar Center [Code] &amp; Operator</th>
                    <th className="p-3.5">Mode / Correction Status</th>
                    <th className="p-3.5 text-center">New</th>
                    <th className="p-3.5 text-center">MBU(F)</th>
                    <th className="p-3.5 text-center">MBU(P)</th>
                    <th className="p-3.5 text-center">Demo</th>
                    <th className="p-3.5 text-center">Bio</th>
                    <th className="p-3.5 text-center">Total</th>
                    <th className="p-3.5 text-right">Cash (₹)</th>
                    <th className="p-3.5 text-center">Deposit</th>
                    <th className="p-3.5 text-center">Vault Files</th>
                    <th className="p-3.5 text-right">Audit / Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredDailyReports.map((r) => (
                    <tr
                      key={r.id}
                      className={`hover:bg-slate-50 ${
                        r.edit_request_status === "Pending" ? "bg-amber-50/50" : ""
                      }`}
                    >
                      <td className="p-3.5 font-black">
                        {formatToDDMMYYYY(r.report_date)}
                      </td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">
                          {r.active_partners?.partner_name}
                        </p>
                        <p className="text-[10px] font-bold text-slate-500">
                          [{r.active_partners?.locations?.center_code || "NO-CODE"}]
                          Op:{" "}
                          <strong className="text-blue-700">
                            {r.operator_id}
                          </strong>{" "}
                          | Stn:{" "}
                          <strong className="text-indigo-700">
                            {r.station_id}
                          </strong>
                        </p>
                      </td>
                      <td className="p-3.5">
                        {r.has_files ? (
                          <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                            CSV + HTML
                          </span>
                        ) : (
                          <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                            Manual ({r.exemption_reason})
                          </span>
                        )}
                        {r.edit_request_status === "Pending" && (
                          <div className="mt-1 flex items-center gap-1">
                            <span
                              title={r.edit_request_reason}
                              className="bg-yellow-200 text-yellow-900 border border-yellow-400 px-1.5 py-0.5 rounded text-[8px] font-black uppercase animate-pulse"
                            >
                              📝 Partner Req: {r.edit_request_reason}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDismissCorrectionRequest(r.id)}
                              className="text-[8px] font-black text-red-600 underline"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 text-center font-bold">
                        {r.cat1_new_qty}
                      </td>
                      <td className="p-3.5 text-center font-bold">
                        {r.cat2_mbu_free_qty}
                      </td>
                      <td className="p-3.5 text-center font-bold">
                        {r.cat3_mbu_chargeable_qty}
                      </td>
                      <td className="p-3.5 text-center font-bold">
                        {r.cat4_demographic_qty}
                      </td>
                      <td className="p-3.5 text-center font-bold">
                        {r.cat5_biometric_qty}
                      </td>
                      <td className="p-3.5 text-center font-black">
                        {r.total_packets_qty}
                      </td>
                      <td className="p-3.5 text-right font-black text-slate-900">
                        ₹{Number(r.total_cash_collected).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                            r.deposit_status === "Pending Deposit"
                              ? "bg-red-100 text-red-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {r.deposit_status}
                        </span>
                      </td>
                      <td className="p-3.5 text-center">
                        {r.has_files ? (
                          <div className="flex justify-center gap-1">
                            <button
                              onClick={() => handleDownloadVaultFile(r.csv_file_url)}
                              className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                            >
                              CSV
                            </button>
                            <button
                              onClick={() =>
                                handleDownloadVaultFile(r.html_file_url)
                              }
                              className="bg-indigo-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                            >
                              HTML
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold">
                            None
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => openReportEditModal(r)}
                          className="bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white font-black px-3 py-1.5 rounded text-[9px] uppercase tracking-wider transition shadow-sm"
                        >
                          ⚙️ Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredDailyReports.length === 0 && (
                    <tr>
                      <td
                        colSpan={13}
                        className="p-10 text-center text-slate-400 font-bold"
                      >
                        No daily Aadhaar records match the selected Station/Operator
                        cascade and date filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 3: APPROVED AADHAAR COLLECTIONS & REMITTANCE LEDGER (REQ #7)     */}
        {/* ===================================================================== */}
        {activeMenu === "collections" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-600">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  Total Enrolment Collection
                </p>
                <p className="text-2xl font-black text-slate-900 mt-1">
                  ₹{kpi.cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] font-bold text-slate-500 mt-1">
                  From {filteredDailyReports.length} Daily Reports
                </p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-emerald-600">
                <p className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">
                  Approved (Verified) Deposits
                </p>
                <p className="text-2xl font-black text-emerald-700 mt-1">
                  ₹
                  {collectionKpi.approvedSum.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <p className="text-[10px] font-bold text-slate-500 mt-1">
                  Cleared by Accounts Department
                </p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-amber-500">
                <p className="text-[10px] font-black uppercase text-amber-700 tracking-widest">
                  Pending Verification Deposits
                </p>
                <p className="text-2xl font-black text-amber-600 mt-1">
                  ₹
                  {collectionKpi.pendingSum.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <p className="text-[10px] font-bold text-red-600 mt-1">
                  Rejected/Discrepancy: ₹
                  {collectionKpi.discrepancySum.toLocaleString("en-IN")}
                </p>
              </div>

              <div className="bg-slate-900 text-white p-5 rounded-xl shadow-lg border-l-4 border-l-red-500">
                <p className="text-[10px] font-black uppercase text-amber-400 tracking-widest">
                  Remaining Balance Payable
                </p>
                <p className="text-2xl font-black text-white mt-1">
                  ₹
                  {collectionKpi.netBalancePayable.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <p className="text-[10px] font-bold text-slate-400 mt-1">
                  (Collection + ₹{collectionKpi.activePenSum} Fines) - Deposits
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-900 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h3 className="font-black text-xs uppercase tracking-widest text-emerald-400">
                    💳 Aadhaar Collection &amp; Remittance Ledger (
                    {filteredDepositsForTable.length} Records)
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    Filtered by State, Master HQ, Aadhaar Center, Station ID,
                    Operator ID, and Date Range
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex bg-slate-800 p-1 rounded-lg text-[10px] font-black uppercase">
                    {(["Verified", "Pending", "Discrepancy", "ALL"] as const).map(
                      (st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setCollectionStatusFilter(st)}
                          className={`px-2.5 py-1 rounded transition ${
                            collectionStatusFilter === st
                              ? "bg-emerald-600 text-white"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {st === "Verified" ? "✅ Approved" : st}
                        </button>
                      )
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleExportCollectionsCSV}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-3.5 py-1.5 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                  >
                    📥 Export Collections CSV
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                    <tr>
                      <th className="p-3.5">Deposit Date</th>
                      <th className="p-3.5">Reference Code</th>
                      <th className="p-3.5">Aadhaar Center [Code]</th>
                      <th className="p-3.5">Operator &amp; Station ID</th>
                      <th className="p-3.5">Method</th>
                      <th className="p-3.5">Unique UTR No</th>
                      <th className="p-3.5">Transaction ID</th>
                      <th className="p-3.5 text-right">Amount (₹)</th>
                      <th className="p-3.5 text-center">Audit Status</th>
                      <th className="p-3.5 text-center">Slip Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredDepositsForTable.map((d: any) => {
                      const loc = d.active_partners?.locations;
                      const cleanUtr =
                        d.utr_number ||
                        String(d.reference_no || "").replace(/^AADHAAR_/i, "");
                      const cleanTxn = d.transaction_id || cleanUtr;
                      const refCode =
                        d.reference_code ||
                        `FA-ADH-${String(d.id || "")
                          .slice(0, 6)
                          .toUpperCase()}`;

                      return (
                        <tr key={d.id} className="hover:bg-slate-50">
                          <td className="p-3.5 font-black">
                            {formatToDDMMYYYY(
                              (d.deposit_date || d.created_at || "").split("T")[0]
                            )}
                          </td>
                          <td className="p-3.5 font-mono font-black text-indigo-700">
                            {refCode}
                          </td>
                          <td className="p-3.5 font-bold text-slate-800">
                            [{loc?.center_code || "NO-CODE"}] {loc?.center_name} (
                            {loc?.state})
                          </td>
                          <td className="p-3.5">
                            <span className="font-black text-slate-900">
                              {d.active_partners?.partner_name}
                            </span>
                            <span className="text-[10px] font-bold text-blue-700 block">
                              Op: {d.active_partners?.aadhaar_operator_id || "N/A"}{" "}
                              | Stn:{" "}
                              {d.active_partners?.aadhaar_station_id || "N/A"}
                            </span>
                          </td>
                          <td className="p-3.5 font-bold text-blue-700">
                            {d.deposit_method}
                          </td>
                          <td className="p-3.5 font-black text-slate-900">
                            {cleanUtr}
                          </td>
                          <td className="p-3.5 font-bold text-slate-600">
                            {cleanTxn}
                          </td>
                          <td
                            className={`p-3.5 text-right font-black text-sm ${
                              d.status === "Discrepancy"
                                ? "text-slate-400 line-through"
                                : "text-emerald-700"
                            }`}
                          >
                            ₹{Number(d.deposit_amount || 0).toLocaleString("en-IN")}
                          </td>
                          <td className="p-3.5 text-center">
                            <span
                              className={`px-2.5 py-1 rounded text-[9px] font-black uppercase ${
                                d.status === "Verified"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : d.status === "Discrepancy"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {d.status === "Verified" ? "Approved" : d.status}
                            </span>
                          </td>
                          <td className="p-3.5 text-center">
                            {d.deposit_slip_url ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleDownloadVaultFile(
                                    d.deposit_slip_url,
                                    "deposit-slips"
                                  )
                                }
                                className="bg-slate-900 hover:bg-blue-600 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase"
                              >
                                📎 View Slip
                              </button>
                            ) : (
                              <span className="text-[9px] text-amber-700 font-bold">
                                Exempted
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredDepositsForTable.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className="p-10 text-center text-slate-400 font-bold"
                        >
                          No Aadhaar collection records match the selected status
                          and cascading filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 4: LIVE WORKING VS. ABSENT / NON-WORKING STATIONS (REQ #10)      */}
        {/* ===================================================================== */}
        {activeMenu === "station_status" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
                <p className="text-[10px] font-black uppercase text-emerald-700">
                  🟢 Live Working Stations
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {
                    liveStationAttendanceMatrix.filter(
                      (s) => s.statusCategory === "WORKING"
                    ).length
                  }
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-amber-500">
                <p className="text-[10px] font-black uppercase text-amber-700">
                  🟡 Partner Absent / Leave
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {
                    liveStationAttendanceMatrix.filter(
                      (s) => s.statusCategory === "LEAVE_ABSENT"
                    ).length
                  }
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-orange-500">
                <p className="text-[10px] font-black uppercase text-orange-700">
                  🟠 Tech / Server Outage
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {
                    liveStationAttendanceMatrix.filter(
                      (s) => s.statusCategory === "TECH_OUTAGE"
                    ).length
                  }
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-blue-500">
                <p className="text-[10px] font-black uppercase text-blue-700">
                  🔵 Center Holiday
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">
                  {
                    liveStationAttendanceMatrix.filter(
                      (s) => s.statusCategory === "HOLIDAY"
                    ).length
                  }
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-red-600">
                <p className="text-[10px] font-black uppercase text-red-700">
                  🔴 Non-Working (Unlogged)
                </p>
                <p className="text-3xl font-black text-red-600 mt-1">
                  {
                    liveStationAttendanceMatrix.filter(
                      (s) => s.statusCategory === "NON_WORKING_UNLOGGED"
                    ).length
                  }
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-900 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h3 className="font-black text-xs uppercase tracking-widest text-amber-400">
                    📡 Live Working, Absent/Leave &amp; Non-Working Stations Report (
                    {visibleStationAttendance.length} Stations)
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    Tracks live operational status, partner leave/absence, and
                    unlogged stations across your cascading filter
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={stationWorkingFilter}
                    onChange={(e) =>
                      setStationWorkingFilter(
                        e.target.value as StationWorkingFilter
                      )
                    }
                    className="bg-slate-800 border border-slate-700 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-lg outline-none"
                  >
                    <option value="ALL">All Stations ({liveStationAttendanceMatrix.length})</option>
                    <option value="WORKING">🟢 Live Working Only</option>
                    <option value="LEAVE_ABSENT">🟡 Absent / On Leave Only</option>
                    <option value="TECH_OUTAGE">🟠 Tech / Server Outage Only</option>
                    <option value="HOLIDAY">🔵 Holiday Closed Only</option>
                    <option value="NON_WORKING_UNLOGGED">
                      🔴 Non-Working (Unlogged) Only
                    </option>
                  </select>

                  <button
                    type="button"
                    onClick={handleExportStationAttendanceCSV}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3.5 py-1.5 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                  >
                    📥 Export Station Status CSV
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                    <tr>
                      <th className="p-3.5">UIDAI Station ID</th>
                      <th className="p-3.5">Aadhaar Center [Code]</th>
                      <th className="p-3.5">Operator Name &amp; ID</th>
                      <th className="p-3.5">Live Operational Status</th>
                      <th className="p-3.5 text-center">Latest Report</th>
                      <th className="p-3.5 text-center">Working Days</th>
                      <th className="p-3.5 text-center">Leave / Absent Days</th>
                      <th className="p-3.5 text-center">Outage Days</th>
                      <th className="p-3.5 text-center">Period Packets</th>
                      <th className="p-3.5 text-right">Period Cash (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleStationAttendance.map((row) => (
                      <tr key={row.partner_id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-black text-indigo-700 text-sm">
                          Stn: {row.station_id}
                        </td>
                        <td className="p-3.5 font-bold text-slate-800">
                          [{row.center_code}] {row.center_name} ({row.state})
                        </td>
                        <td className="p-3.5">
                          <span className="font-black text-slate-900">
                            {row.partner_name}
                          </span>
                          <span className="text-[10px] font-bold text-blue-700 block">
                            Op: {row.operator_id} • 📞 {row.mobile}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-1 rounded text-[10px] font-black uppercase ${
                              row.statusCategory === "WORKING"
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : row.statusCategory === "LEAVE_ABSENT"
                                ? "bg-amber-100 text-amber-900 border border-amber-300"
                                : row.statusCategory === "TECH_OUTAGE"
                                ? "bg-orange-100 text-orange-800 border border-orange-200"
                                : row.statusCategory === "HOLIDAY"
                                ? "bg-blue-100 text-blue-800 border border-blue-200"
                                : "bg-red-100 text-red-800 border border-red-200"
                            }`}
                          >
                            {row.statusBadge}
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-bold text-slate-700">
                          {row.latestReportDate}
                        </td>
                        <td className="p-3.5 text-center font-black text-emerald-700">
                          {row.workingDaysCount}
                        </td>
                        <td className="p-3.5 text-center font-black text-amber-700">
                          {row.leaveDaysCount}
                        </td>
                        <td className="p-3.5 text-center font-bold text-orange-700">
                          {row.outageDaysCount}
                        </td>
                        <td className="p-3.5 text-center font-black">
                          {row.totalPacketsInWindow}
                        </td>
                        <td className="p-3.5 text-right font-black text-slate-900">
                          ₹{row.totalCashInWindow.toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                    {visibleStationAttendance.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className="p-10 text-center text-slate-400 font-bold"
                        >
                          No stations match the selected operational status and
                          cascading filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 5: WEEKLY VS DAILY RECONCILIATION AUDIT                          */}
        {/* ===================================================================== */}
        {activeMenu === "weekly_audit" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 text-white">
              <h3 className="font-black text-xs uppercase tracking-widest">
                Weekly vs. Daily Reconciliation Audit (
                {filteredWeeklyReports.length} Submissions)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                  <tr>
                    <th className="p-3.5">Week Range (Mon &rarr; Sun)</th>
                    <th className="p-3.5">Aadhaar Center [Code] &amp; Operator</th>
                    <th className="p-3.5 text-center">Weekly Packets</th>
                    <th className="p-3.5 text-center">Rejected Pkts</th>
                    <th className="p-3.5 text-right">Weekly Cash (₹)</th>
                    <th className="p-3.5 text-center">Audit Status</th>
                    <th className="p-3.5 text-center">Files</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredWeeklyReports.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black">
                        {formatToDDMMYYYY(w.start_date)} &rarr;{" "}
                        {formatToDDMMYYYY(w.end_date)}
                      </td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">
                          {w.active_partners?.partner_name}
                        </p>
                        <p className="text-[10px] font-bold text-slate-500">
                          [{w.active_partners?.locations?.center_code || "NO-CODE"}]{" "}
                          {w.operator_id} | Stn: {w.station_id}
                        </p>
                      </td>
                      <td className="p-3.5 text-center font-black">
                        {w.total_packets_qty}
                      </td>
                      <td className="p-3.5 text-center font-black text-red-600">
                        {w.rejected_qty}
                      </td>
                      <td className="p-3.5 text-right font-black">
                        ₹{Number(w.total_cash_collected).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center">
                        {w.discrepancy_days_count === 0 ? (
                          <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded text-[10px] font-black uppercase">
                            ✅ 100% Matched
                          </span>
                        ) : (
                          <span className="bg-red-100 text-red-800 px-2.5 py-1 rounded text-[10px] font-black uppercase">
                            🚨 {w.discrepancy_days_count} Day(s) Mismatched
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => handleDownloadVaultFile(w.csv_file_url)}
                            className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                          >
                            CSV
                          </button>
                          <button
                            onClick={() => handleDownloadVaultFile(w.html_file_url)}
                            className="bg-indigo-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                          >
                            HTML
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 6: ₹100/DAY LATE PENALTY LEDGER & ADMIN WAIVE-OFF (REQ #8)       */}
        {/* ===================================================================== */}
        {activeMenu === "penalties" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h3 className="font-black text-xs uppercase tracking-widest">
                  Automated ₹100/Day Late Payment Penalty &amp; Admin Waive-Off
                  Ledger
                </h3>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                  Waiving off a penalty permanently records the Admin identity,
                  timestamp, and reason and deducts it from the partner&apos;s
                  payable balance.
                </p>
              </div>
              <div className="flex gap-4 text-xs font-black">
                <span className="text-red-400">
                  Unpaid: ₹{unpaidPenaltiesSum.toLocaleString("en-IN")}
                </span>
                <span className="text-amber-400">
                  Waived Off: ₹{waivedPenaltiesSum.toLocaleString("en-IN")}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                  <tr>
                    <th className="p-3.5">Penalty Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Overdue Report Date</th>
                    <th className="p-3.5">Aadhaar Center [Code] &amp; Operator</th>
                    <th className="p-3.5 text-right">Penalty Charged</th>
                    <th className="p-3.5 text-center">Status &amp; Audit Record</th>
                    <th className="p-3.5 text-right">Admin Waive-Off</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredPenalties.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black">
                        {formatToDDMMYYYY(p.penalty_for_date)}
                      </td>
                      <td className="p-3.5 font-bold text-red-600">
                        {formatToDDMMYYYY(p.report_date)}
                      </td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">
                          {p.active_partners?.partner_name}
                        </p>
                        <p className="text-[10px] font-bold text-slate-500">
                          [
                          {p.active_partners?.locations?.center_code ||
                            "NO-CODE"}
                          ] {p.active_partners?.aadhaar_operator_id} | Stn:{" "}
                          {p.active_partners?.aadhaar_station_id}
                        </p>
                      </td>
                      <td
                        className={`p-3.5 text-right font-black ${
                          p.is_waived
                            ? "text-slate-400 line-through"
                            : "text-red-600"
                        }`}
                      >
                        ₹{Number(p.penalty_amount).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center">
                        {p.is_waived ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="px-2.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300">
                              ✅ Waived Off by Admin
                            </span>
                            <span className="text-[9px] font-bold text-slate-500 mt-0.5">
                              {p.waived_by_email || "Admin"} •{" "}
                              {p.waived_at
                                ? formatToDDMMYYYY(p.waived_at)
                                : ""}{" "}
                              ({p.waive_reason || "Waived"})
                            </span>
                          </div>
                        ) : p.is_settled ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-100 text-emerald-800">
                            Settled via Deposit
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-red-100 text-red-800">
                            Unpaid in Ledger
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        {!p.is_waived && !p.is_settled ? (
                          <button
                            type="button"
                            onClick={() => {
                              setWaivingPenalty(p);
                              setWaiveReasonText("");
                            }}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider shadow-sm transition"
                          >
                            🛡️ Waive Off Penalty
                          </button>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 uppercase">
                            {p.is_waived ? "Waived & Locked" : "Settled"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredPenalties.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-10 text-center text-slate-400 font-bold"
                      >
                        No penalty records found for the selected filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 7: MODULAR OPERATOR ROLE & AADHAAR CENTER MAPPING ENGINE         */}
        {/* ===================================================================== */}
        {activeMenu === "operators" && (
          <AdminOperatorMappingModule
            locations={locations}
            partners={partners}
            upgradeRequests={upgradeRequests}
            staffUser={staffUser}
            onRefresh={initializeAdminAadhaarHub}
            onDownloadVaultFile={handleDownloadVaultFile}
          />
        )}

        {/* ===================================================================== */}
        {/* MENU 8: UIDAI TARIFF MASTER                                           */}
        {/* ===================================================================== */}
        {activeMenu === "tariff_master" && isSuperAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-fit">
              <h3 className="font-black text-base text-slate-900 border-b pb-3 mb-2">
                Deploy New UIDAI Tariff Version
              </h3>
              <p className="text-[11px] font-bold text-slate-500 mb-4">
                Setting a new Effective Date automatically closes the previous
                tariff on the prior day, ensuring backdated reports are never
                altered.
              </p>
              <form
                onSubmit={handleCreateNewTariffVersion}
                className="space-y-3 text-xs"
              >
                <div>
                  <label className="block text-[10px] font-black uppercase text-blue-700 mb-1">
                    Effective From Date (
                    {formatToDDMMYYYY(tariffForm.effective_from)}) *
                  </label>
                  <input
                    type="date"
                    required
                    value={tariffForm.effective_from}
                    onChange={(e) =>
                      setTariffForm({
                        ...tariffForm,
                        effective_from: e.target.value,
                      })
                    }
                    className="w-full border-2 border-blue-200 p-2.5 rounded-lg font-black bg-blue-50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">
                      3. MBU Paid (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={tariffForm.mbu_chargeable_fee}
                      onChange={(e) =>
                        setTariffForm({
                          ...tariffForm,
                          mbu_chargeable_fee: e.target.value,
                        })
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">
                      4. Demographic (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={tariffForm.demographic_fee}
                      onChange={(e) =>
                        setTariffForm({
                          ...tariffForm,
                          demographic_fee: e.target.value,
                        })
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">
                      5. Biometric (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={tariffForm.biometric_fee}
                      onChange={(e) =>
                        setTariffForm({
                          ...tariffForm,
                          biometric_fee: e.target.value,
                        })
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-red-600">
                      Late Fine / Day (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={tariffForm.daily_late_penalty}
                      onChange={(e) =>
                        setTariffForm({
                          ...tariffForm,
                          daily_late_penalty: e.target.value,
                        })
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">
                      Demo Min (&gt; ₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={tariffForm.demo_min_threshold}
                      onChange={(e) =>
                        setTariffForm({
                          ...tariffForm,
                          demo_min_threshold: e.target.value,
                        })
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">
                      Demo Max (&lt; ₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={tariffForm.demo_max_threshold}
                      onChange={(e) =>
                        setTariffForm({
                          ...tariffForm,
                          demo_max_threshold: e.target.value,
                        })
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSavingTariff}
                  className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white font-black uppercase tracking-widest rounded-xl shadow mt-2 transition"
                >
                  {isSavingTariff ? "Deploying..." : "Commit New Tariff Version"}
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit">
              <div className="p-4 bg-slate-900 text-white">
                <h3 className="font-black text-xs uppercase tracking-widest">
                  UIDAI Tariff Version History (Backdate Protection Log)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                    <tr>
                      <th className="p-3.5">Effective From</th>
                      <th className="p-3.5">Effective To</th>
                      <th className="p-3.5 text-center">MBU Paid</th>
                      <th className="p-3.5 text-center">Demographic</th>
                      <th className="p-3.5 text-center">Biometric</th>
                      <th className="p-3.5 text-center">Demo Range</th>
                      <th className="p-3.5 text-center">Late Fine</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tariffHistory.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-black text-emerald-700">
                          {formatToDDMMYYYY(t.effective_from)}
                        </td>
                        <td className="p-3.5 font-black text-slate-600">
                          {t.effective_to
                            ? formatToDDMMYYYY(t.effective_to)
                            : "ACTIVE NOW"}
                        </td>
                        <td className="p-3.5 text-center font-bold">
                          ₹{t.mbu_chargeable_fee}
                        </td>
                        <td className="p-3.5 text-center font-bold">
                          ₹{t.demographic_fee}
                        </td>
                        <td className="p-3.5 text-center font-bold">
                          ₹{t.biometric_fee}
                        </td>
                        <td className="p-3.5 text-center font-bold">
                          &gt;₹{t.demo_min_threshold} &amp; &lt;₹
                          {t.demo_max_threshold}
                        </td>
                        <td className="p-3.5 text-center font-black text-red-600">
                          ₹{t.daily_late_penalty}/d
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MODAL A: ADMIN PENALTY WAIVE-OFF CONFIRMATION MODAL (REQ #8)          */}
        {/* ===================================================================== */}
        {waivingPenalty && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-lg overflow-hidden animate-in zoom-in-95">
              <div className="p-5 bg-slate-900 text-white flex justify-between items-center border-b-4 border-amber-500">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 block">
                    Admin Penalty Waive-Off Authorization
                  </span>
                  <h3 className="font-black text-base mt-0.5">
                    Waive ₹{waivingPenalty.penalty_amount} Late Fine —{" "}
                    {waivingPenalty.active_partners?.partner_name}
                  </h3>
                </div>
                <button
                  onClick={() => setWaivingPenalty(null)}
                  className="text-2xl font-black text-slate-400 hover:text-white"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleConfirmPenaltyWaiveOff} className="p-6 space-y-4 text-xs">
                <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl space-y-1">
                  <p className="font-bold text-amber-950">
                    Overdue Report Date:{" "}
                    <strong>{formatToDDMMYYYY(waivingPenalty.report_date)}</strong>{" "}
                    | Penalty Date:{" "}
                    <strong>
                      {formatToDDMMYYYY(waivingPenalty.penalty_for_date)}
                    </strong>
                  </p>
                  <p className="text-[11px] font-bold text-amber-800">
                    Operator ID:{" "}
                    {waivingPenalty.active_partners?.aadhaar_operator_id} |
                    Station ID:{" "}
                    {waivingPenalty.active_partners?.aadhaar_station_id}
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 mb-1.5">
                    Mandatory Waive-Off Reason (Recorded in Audit Log) *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="ENTER REASON FOR WAIVING OFF THIS LATE PENALTY..."
                    value={waiveReasonText}
                    onChange={(e) =>
                      setWaiveReasonText(e.target.value.toUpperCase())
                    }
                    className="w-full border-2 border-slate-300 p-3 rounded-xl font-bold text-slate-900 uppercase outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setWaivingPenalty(null)}
                    className="px-4 py-2.5 bg-slate-200 text-slate-700 font-black uppercase rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessingWaive}
                    className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black uppercase rounded-lg shadow"
                  >
                    {isProcessingWaive
                      ? "Recording Waive-Off..."
                      : "✅ Confirm & Record Waive-Off"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MODAL B: FORCE-EDIT / AUDIT MODAL FOR AADHAAR DAILY REPORTS (MENU 2)  */}
        {/* ===================================================================== */}
        {editingReport && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-slate-50 rounded-2xl shadow-2xl border border-slate-300 w-full max-w-3xl my-8 animate-in zoom-in-95 overflow-hidden">
              <div className="p-5 bg-slate-900 text-white flex justify-between items-center border-b-4 border-amber-500">
                <div>
                  <h3 className="font-black text-lg">
                    🆔 Audit &amp; Edit Aadhaar Report:{" "}
                    {editingReport.active_partners?.partner_name}
                  </h3>
                  <p className="text-xs text-amber-400 font-bold mt-0.5">
                    Date: {formatToDDMMYYYY(editingReport.report_date)} | Op:{" "}
                    {editingReport.operator_id} | Stn: {editingReport.station_id}
                  </p>
                </div>
                <button
                  onClick={() => setEditingReport(null)}
                  className="text-2xl font-black text-slate-400 hover:text-white"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSaveReportEdit} className="p-6 space-y-5 text-xs">
                {editingReport.edit_request_reason && (
                  <div className="p-3.5 bg-yellow-50 border-2 border-yellow-300 rounded-xl text-yellow-950 font-bold">
                    📝 Partner Correction Request: &quot;
                    {editingReport.edit_request_reason}&quot;
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-white p-4 rounded-xl border border-slate-200">
                  <div>
                    <label className="font-black uppercase text-slate-500 text-[10px]">
                      1. New (₹0)
                    </label>
                    <input
                      type="number"
                      min="0"
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={editingReport.cat1_new_qty}
                      onChange={(e) =>
                        handleEditCategoryQty("cat1_new_qty", e.target.value)
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="font-black uppercase text-slate-500 text-[10px]">
                      2. MBU Free
                    </label>
                    <input
                      type="number"
                      min="0"
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={editingReport.cat2_mbu_free_qty}
                      onChange={(e) =>
                        handleEditCategoryQty("cat2_mbu_free_qty", e.target.value)
                      }
                      className={`${noScrollNumClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="font-black uppercase text-amber-700 text-[10px]">
                      3. MBU Paid
                    </label>
                    <input
                      type="number"
                      min="0"
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={editingReport.cat3_mbu_chargeable_qty}
                      onChange={(e) =>
                        handleEditCategoryQty(
                          "cat3_mbu_chargeable_qty",
                          e.target.value
                        )
                      }
                      className={`${noScrollNumClass} border-amber-300 bg-amber-50 mt-1`}
                    />
                  </div>
                  <div>
                    <label className="font-black uppercase text-blue-700 text-[10px]">
                      4. Demographic
                    </label>
                    <input
                      type="number"
                      min="0"
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={editingReport.cat4_demographic_qty}
                      onChange={(e) =>
                        handleEditCategoryQty(
                          "cat4_demographic_qty",
                          e.target.value
                        )
                      }
                      className={`${noScrollNumClass} border-blue-300 bg-blue-50 mt-1`}
                    />
                  </div>
                  <div>
                    <label className="font-black uppercase text-purple-700 text-[10px]">
                      5. Biometric
                    </label>
                    <input
                      type="number"
                      min="0"
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={editingReport.cat5_biometric_qty}
                      onChange={(e) =>
                        handleEditCategoryQty(
                          "cat5_biometric_qty",
                          e.target.value
                        )
                      }
                      className={`${noScrollNumClass} border-purple-300 bg-purple-50 mt-1`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-slate-200">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="font-black uppercase text-slate-600 text-[10px]">
                        Total Cash Collected (₹)
                      </label>
                      <label className="flex items-center gap-1 text-[10px] font-black text-amber-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={manualCashOverride}
                          onChange={(e) =>
                            setManualCashOverride(e.target.checked)
                          }
                        />
                        Manual Override
                      </label>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      disabled={!manualCashOverride}
                      onWheel={handleNumericWheel}
                      onKeyDown={handleNumericKeyDown}
                      value={editingReport.total_cash_collected}
                      onChange={(e) =>
                        setEditingReport({
                          ...editingReport,
                          total_cash_collected: parseFloat(e.target.value) || 0,
                        })
                      }
                      className={`${noScrollNumClass} text-sm disabled:bg-slate-100`}
                    />
                  </div>

                  <div>
                    <label className="font-black uppercase text-slate-600 text-[10px] block mb-1">
                      Deposit Settlement Status
                    </label>
                    <select
                      value={editingReport.deposit_status}
                      onChange={(e) =>
                        setEditingReport({
                          ...editingReport,
                          deposit_status: e.target.value,
                        })
                      }
                      className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold text-xs bg-white"
                    >
                      <option value="Pending Deposit">Pending Deposit</option>
                      <option value="Deposit Submitted">Deposit Submitted</option>
                      <option value="Settled">Settled</option>
                    </select>
                  </div>
                </div>

                <div className="bg-slate-900 p-4 rounded-xl space-y-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-amber-400 block mb-1">
                      Mandatory Audit Reason *
                    </label>
                    <select
                      required
                      value={auditReasonCategory}
                      onChange={(e) => {
                        setAuditReasonCategory(e.target.value);
                        setAuditOtherText("");
                      }}
                      className="w-full bg-slate-800 border border-slate-700 text-white p-2.5 rounded-lg font-bold"
                    >
                      <option value="" disabled>
                        -- Select Audit Reason --
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

                  {auditReasonCategory === "Other" && (
                    <input
                      type="text"
                      required
                      placeholder="TYPE DETAILED AUDIT REASON..."
                      value={auditOtherText}
                      onChange={(e) =>
                        setAuditOtherText(e.target.value.toUpperCase())
                      }
                      className="w-full bg-slate-800 border border-amber-500 text-white p-2.5 rounded-lg font-black uppercase"
                    />
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingReport(null)}
                      className="px-4 py-2.5 bg-slate-700 text-white font-black uppercase rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingEdit}
                      className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black uppercase rounded-lg shadow"
                    >
                      {isSavingEdit ? "Saving..." : "Apply Audit Overwrite"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}