// FILE PATH: ./app/dashboard/reports/page.tsx
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
  downloadAadhaarCSVReport,
  downloadAadhaarPDFReport,
} from "../../lib/aadhaarEngine";

type ReportStreamType = "aadhaar" | "sales" | "deposits" | "consolidated";
type AadhaarGroupingMode = "DAILY_LEDGER" | "STATION_WISE" | "OPERATOR_WISE";

// CSV Formula-Injection Sanitizer
const sanitizeCSV = (val: unknown): string => {
  let str = String(val ?? "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

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

export default function CorporateMISReportsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Active Report Stream & Aadhaar Grouping Mode
  const [reportType, setReportType] = useState<ReportStreamType>("aadhaar");
  const [aadhaarGroupMode, setAadhaarGroupMode] =
    useState<AadhaarGroupingMode>("DAILY_LEDGER");

  // Master Data Streams
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [allPartners, setAllPartners] = useState<any[]>([]);
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawAadhaar, setRawAadhaar] = useState<any[]>([]);
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);
  const [rawPenalties, setRawPenalties] = useState<any[]>([]);

  // 7-Option Date Preset + Custom Range States (DD/MM/YYYY)
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [toDate, setToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );

  // 5-Tier Cascading Filter States (State -> Master HQ -> Center -> Station ID -> Operator)
  const [fState, setFState] = useState<string>("ALL");
  const [fHq, setFHq] = useState<string>("ALL");
  const [fCenter, setFCenter] = useState<string>("ALL");
  const [fStation, setFStation] = useState<string>("ALL");
  const [fPartner, setFPartner] = useState<string>("ALL");

  // Stream-Specific Sub-Filters
  const [fFileMode, setFFileMode] = useState<
    "ALL" | "WITH_FILES" | "WITHOUT_FILES"
  >("ALL");
  const [fDepositStatus, setFDepositStatus] = useState<
    "ALL" | "Verified" | "Pending" | "Discrepancy"
  >("ALL");

  // Mandatory Download Request Checkbox Gate
  const [confirmDownloadCheck, setConfirmDownloadCheck] =
    useState<boolean>(false);

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
    fetchMISData();
  }, [fromDate, toDate]);

  const fetchMISData = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [locRes, partRes, salesRes, aadhaarRes, depRes, penRes] =
        await Promise.all([
          supabase.from("locations").select("*").order("center_name"),
          supabase
            .from("active_partners")
            .select(
              "id, partner_name, email, mobile, role, status, role_aadhaar, aadhaar_operator_id, aadhaar_station_id, center_id, locations(id, center_name, center_code, state, dist, taluk, parent_master_id, role_aadhaar)"
            )
            .order("partner_name"),
          supabase
            .from("daily_sales_reports")
            .select(
              "*, active_partners(id, partner_name, role, aadhaar_operator_id, aadhaar_station_id, locations(id, center_name, center_code, state, dist, parent_master_id, role_aadhaar))"
            )
            .gte("report_date", fromDate)
            .lte("report_date", toDate)
            .order("report_date", { ascending: false }),
          supabase
            .from("aadhaar_daily_reports")
            .select(
              "*, active_partners(id, partner_name, role, aadhaar_operator_id, aadhaar_station_id, locations(id, center_name, center_code, state, dist, parent_master_id, role_aadhaar))"
            )
            .gte("report_date", fromDate)
            .lte("report_date", toDate)
            .order("report_date", { ascending: false }),
          supabase
            .from("partner_deposits")
            .select(
              "*, active_partners(id, partner_name, email, role, aadhaar_operator_id, aadhaar_station_id, locations(id, state, dist, center_name, center_code, parent_master_id, role_aadhaar))"
            )
            .gte("deposit_date", fromDate)
            .lte("deposit_date", toDate)
            .order("deposit_date", { ascending: false }),
          supabase
            .from("aadhaar_penalty_logs")
            .select("*")
            .eq("is_settled", false),
        ]);

      setAllLocations(locRes.data || []);
      setAllPartners(partRes.data || []);
      setRawSales(salesRes.data || []);
      setRawAadhaar(aadhaarRes.data || []);
      setRawDeposits(depRes.data || []);
      // Filter out Admin-waived penalties so waived fines are never added to net closing due
      setRawPenalties((penRes.data || []).filter((p: any) => !p.is_waived));
    } catch (err: any) {
      console.error("MIS Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // 5-TIER CASCADING FILTER OPTIONS (STRICT AADHAAR-ONLY WHEN AADHAAR SELECTED)
  // =========================================================================
  const isStrictAadhaarMode = reportType === "aadhaar";

  const eligibleSpokeCenters = useMemo(() => {
    return allLocations.filter(
      (l) =>
        !l.is_master_node && (!isStrictAadhaarMode || l.role_aadhaar === true)
    );
  }, [allLocations, isStrictAadhaarMode]);

  const uniqueStates = useMemo(
    () =>
      Array.from(
        new Set(eligibleSpokeCenters.map((l) => l.state).filter(Boolean))
      ).sort(),
    [eligibleSpokeCenters]
  );

  const hqOptions = useMemo(() => {
    const validHqIds = new Set(
      eligibleSpokeCenters
        .filter((c) => fState === "ALL" || c.state === fState)
        .map((c) => c.parent_master_id)
        .filter(Boolean)
    );
    return allLocations.filter((l) => l.is_master_node && validHqIds.has(l.id));
  }, [allLocations, eligibleSpokeCenters, fState]);

  const centerOptions = useMemo(
    () =>
      eligibleSpokeCenters.filter(
        (l) =>
          (fState === "ALL" || l.state === fState) &&
          (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
      ),
    [eligibleSpokeCenters, fState, fHq]
  );

  const stationOptions = useMemo(() => {
    const stnMap = new Map<
      string,
      { station_id: string; center_code: string; operatorCount: number }
    >();

    allPartners.forEach((p) => {
      if (!p.aadhaar_station_id) return;
      const locData = p.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      if (!loc) return;
      if (isStrictAadhaarMode && !loc.role_aadhaar) return;
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

    rawAadhaar.forEach((r) => {
      if (!r.station_id) return;
      const locData = r.active_partners?.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      if (!loc) return;
      if (isStrictAadhaarMode && !loc.role_aadhaar) return;
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
  }, [allPartners, rawAadhaar, isStrictAadhaarMode, fState, fHq, fCenter]);

  const operatorOptions = useMemo(() => {
    return allPartners.filter((p) => {
      if (
        isStrictAadhaarMode &&
        (!p.role_aadhaar || !p.aadhaar_operator_id || !p.aadhaar_station_id)
      ) {
        return false;
      }
      const locData = p.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      if (!loc) return false;
      if (isStrictAadhaarMode && !loc.role_aadhaar) return false;
      if (fState !== "ALL" && loc.state !== fState) return false;
      if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq)
        return false;
      if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return false;
      if (fStation !== "ALL" && p.aadhaar_station_id !== fStation) return false;
      return true;
    });
  }, [allPartners, isStrictAadhaarMode, fState, fHq, fCenter, fStation]);

  const matchesCascade = (
    partnerId: string,
    partnerObj: any,
    rowStationId?: string
  ) => {
    const locData = partnerObj?.locations;
    const loc: any = Array.isArray(locData) ? locData[0] : locData;
    if (!loc) return false;
    if (isStrictAadhaarMode && !loc.role_aadhaar) return false;
    if (fState !== "ALL" && loc.state !== fState) return false;
    if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq) return false;
    if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return false;

    const effectiveStation = rowStationId || partnerObj?.aadhaar_station_id;
    if (fStation !== "ALL" && effectiveStation !== fStation) return false;
    if (
      fPartner !== "ALL" &&
      partnerId !== fPartner &&
      partnerObj?.id !== fPartner
    )
      return false;
    return true;
  };

  // =========================================================================
  // FILTERED DATA STREAMS & AGGREGATION MATRICES
  // =========================================================================
  const filteredAadhaar = useMemo(() => {
    return rawAadhaar.filter((r) => {
      if (!matchesCascade(r.partner_id, r.active_partners, r.station_id))
        return false;
      if (fFileMode === "WITH_FILES" && !r.has_files) return false;
      if (fFileMode === "WITHOUT_FILES" && r.has_files) return false;
      return true;
    });
  }, [
    rawAadhaar,
    fState,
    fHq,
    fCenter,
    fStation,
    fPartner,
    fFileMode,
    isStrictAadhaarMode,
  ]);

  const aadhaarStationWiseMatrix = useMemo(() => {
    const map: Record<string, any> = {};
    filteredAadhaar.forEach((r) => {
      const stn = r.station_id || "UNMAPPED";
      const locData = r.active_partners?.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
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
      map[stn].rejected += Number(r.rejected_qty || 0);
      map[stn].baseAmt += Number(r.base_amount || 0);
      map[stn].gstAmt += Number(r.gst_amount || 0);
      map[stn].totalCash += Number(r.total_cash_collected || 0);
    });
    return Object.values(map).map((item: any) => ({
      ...item,
      operatorsList: Array.from(item.operatorsSet),
    }));
  }, [filteredAadhaar]);

  const aadhaarOperatorWiseMatrix = useMemo(() => {
    const map: Record<string, any> = {};
    filteredAadhaar.forEach((r) => {
      const key = `${r.operator_id || "NO-OP"}_${r.station_id || "NO-STN"}`;
      const locData = r.active_partners?.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      if (!map[key]) {
        map[key] = {
          key,
          operator_id: r.operator_id || "UNMAPPED",
          station_id: r.station_id || "UNMAPPED",
          partner_name: r.active_partners?.partner_name || "Unknown",
          center_code: loc?.center_code || "NO-CODE",
          center_name: loc?.center_name || "Unassigned",
          state: loc?.state || "N/A",
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
  }, [filteredAadhaar]);

  const filteredSales = useMemo(() => {
    return rawSales.filter((s) =>
      matchesCascade(s.partner_id, s.active_partners)
    );
  }, [rawSales, fState, fHq, fCenter, fStation, fPartner, isStrictAadhaarMode]);

  const filteredDeposits = useMemo(() => {
    return rawDeposits.filter((d) => {
      if (!matchesCascade(d.partner_id, d.active_partners)) return false;
      if (fDepositStatus !== "ALL") {
        if (
          fDepositStatus === "Pending" &&
          !String(d.status || "").includes("Pending")
        )
          return false;
        if (fDepositStatus !== "Pending" && d.status !== fDepositStatus)
          return false;
      }
      return true;
    });
  }, [
    rawDeposits,
    fState,
    fHq,
    fCenter,
    fStation,
    fPartner,
    fDepositStatus,
    isStrictAadhaarMode,
  ]);

  const consolidatedPartnerMatrix = useMemo(() => {
    return operatorOptions.map((p) => {
      const locData = p.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;
      const pSales = rawSales.filter((s) => s.partner_id === p.id);
      const pAadhaar = rawAadhaar.filter((a) => a.partner_id === p.id);
      const pDeposits = rawDeposits.filter(
        (d) => d.partner_id === p.id && d.status !== "Discrepancy"
      );
      const pPenalties = rawPenalties.filter((pen) => {
        if (pen.partner_id !== p.id || pen.is_waived) return false;
        const pDate = normalizeToYYYYMMDD(
          pen.penalty_for_date || pen.report_date || ""
        );
        return !pDate || (pDate >= fromDate && pDate <= toDate);
      });

      let telecomCash = 0;
      let paybullCash = 0;
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
          Number(s.mnp_amt || 0);
        paybullCash +=
          Number(s.pb_cbp_amt || 0) +
          Number(s.pb_ctop_amt || 0) +
          Number(s.pb_frc_amt || 0) +
          Number(s.pb_mnp_amt || 0) +
          Number(s.pb_other_amt || 0);
      });

      const aadhaarCash = pAadhaar.reduce(
        (sum, a) => sum + Number(a.total_cash_collected || 0),
        0
      );
      const unpaidPenalties = pPenalties.reduce(
        (sum, pen) => sum + Number(pen.penalty_amount || 0),
        0
      );
      const totalGenerated =
        telecomCash + paybullCash + aadhaarCash + unpaidPenalties;
      const totalRemitted = pDeposits.reduce(
        (sum, d) => sum + Number(d.deposit_amount || 0),
        0
      );
      const netClosingDue = Math.max(0, totalGenerated - totalRemitted);

      return {
        id: p.id,
        partner_name: p.partner_name,
        role: p.role,
        operator_id: p.aadhaar_operator_id || "N/A",
        station_id: p.aadhaar_station_id || "N/A",
        center_code: loc?.center_code || "NO-CODE",
        center_name: loc?.center_name || "Unassigned",
        state: loc?.state || "N/A",
        telecomCash,
        paybullCash,
        aadhaarCash,
        unpaidPenalties,
        totalGenerated,
        totalRemitted,
        netClosingDue,
      };
    });
  }, [
    operatorOptions,
    rawSales,
    rawAadhaar,
    rawDeposits,
    rawPenalties,
    fromDate,
    toDate,
  ]);

  const activeRowCount = useMemo(() => {
    if (reportType === "aadhaar") {
      if (aadhaarGroupMode === "STATION_WISE")
        return aadhaarStationWiseMatrix.length;
      if (aadhaarGroupMode === "OPERATOR_WISE")
        return aadhaarOperatorWiseMatrix.length;
      return filteredAadhaar.length;
    }
    if (reportType === "sales") return filteredSales.length;
    if (reportType === "deposits") return filteredDeposits.length;
    return consolidatedPartnerMatrix.length;
  }, [
    reportType,
    aadhaarGroupMode,
    filteredAadhaar.length,
    aadhaarStationWiseMatrix.length,
    aadhaarOperatorWiseMatrix.length,
    filteredSales.length,
    filteredDeposits.length,
    consolidatedPartnerMatrix.length,
  ]);

  const isDownloadReady = Boolean(
    fromDate && toDate && activeRowCount > 0 && confirmDownloadCheck
  );

  // =========================================================================
  // UNIFIED CSV & PDF EXPORT HANDLERS (INCLUDES REF CODE, UNIQUE UTR & TXN ID)
  // =========================================================================
  const handleExecuteCSVExport = () => {
    if (!isDownloadReady) return;

    const dateTag = `${formatToDDMMYYYY(fromDate).replace(
      /\//g,
      "-"
    )}_to_${formatToDDMMYYYY(toDate).replace(/\//g, "-")}`;

    if (reportType === "aadhaar") {
      if (aadhaarGroupMode === "DAILY_LEDGER") {
        downloadAadhaarCSVReport(
          filteredAadhaar,
          `${fFileMode}_Stn_${fStation}`
        );
        return;
      }

      if (aadhaarGroupMode === "STATION_WISE") {
        const headers = [
          "Date Window",
          "UIDAI Station ID",
          "Center Code",
          "Center Name",
          "State",
          "Operators on Station",
          "Reports Logged",
          "1. New (Free)",
          "2. MBU (Free)",
          "3. MBU (Paid)",
          "4. Demographic",
          "5. Biometric",
          "Total Packets",
          "Rejected Packets",
          "Base Fee (INR)",
          "18% GST (INR)",
          "Total Station Cash (INR)",
        ];
        const rows = aadhaarStationWiseMatrix.map((s: any) =>
          [
            sanitizeCSV(
              `${formatToDDMMYYYY(fromDate)} to ${formatToDDMMYYYY(toDate)}`
            ),
            sanitizeCSV(s.station_id),
            sanitizeCSV(s.center_code),
            sanitizeCSV(s.center_name),
            sanitizeCSV(s.state),
            sanitizeCSV(s.operatorsList.join(" | ")),
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
        triggerBlobDownload(
          [headers.join(","), ...rows].join("\n"),
          `FastArk_MIS_Aadhaar_STATION_WISE_${dateTag}.csv`
        );
        return;
      }

      if (aadhaarGroupMode === "OPERATOR_WISE") {
        const headers = [
          "Date Window",
          "UIDAI Operator ID",
          "UIDAI Station ID",
          "Operator Name",
          "Center Code",
          "Center Name",
          "State",
          "Days Logged",
          "1. New (Free)",
          "2. MBU (Free)",
          "3. MBU (Paid)",
          "4. Demographic",
          "5. Biometric",
          "Total Packets",
          "Rejected Packets",
          "Total Operator Cash (INR)",
        ];
        const rows = aadhaarOperatorWiseMatrix.map((o: any) =>
          [
            sanitizeCSV(
              `${formatToDDMMYYYY(fromDate)} to ${formatToDDMMYYYY(toDate)}`
            ),
            sanitizeCSV(o.operator_id),
            sanitizeCSV(o.station_id),
            sanitizeCSV(o.partner_name),
            sanitizeCSV(o.center_code),
            sanitizeCSV(o.center_name),
            sanitizeCSV(o.state),
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
        triggerBlobDownload(
          [headers.join(","), ...rows].join("\n"),
          `FastArk_MIS_Aadhaar_OPERATOR_WISE_${dateTag}.csv`
        );
        return;
      }
    }

    if (reportType === "sales") {
      const headers = [
        "Report Date (DD/MM/YYYY)",
        "State",
        "Center Code",
        "Center Name",
        "Partner Name",
        "CBP Landline (INR)",
        "CBP GSM (INR)",
        "CTOP Recharge (INR)",
        "FRC (INR)",
        "MNP (INR)",
        "SIM Replacement (INR)",
        "SIM Fancy (INR)",
        "Postpaid (INR)",
        "Other Cash (INR)",
        "Paybull Total (INR)",
        "Total Gross Cash (INR)",
      ];
      const rows = filteredSales.map((s) => {
        const locData = s.active_partners?.locations;
        const loc: any = Array.isArray(locData) ? locData[0] : locData;
        const pbTotal =
          Number(s.pb_cbp_amt || 0) +
          Number(s.pb_ctop_amt || 0) +
          Number(s.pb_frc_amt || 0) +
          Number(s.pb_mnp_amt || 0) +
          Number(s.pb_other_amt || 0);
        const gross =
          Number(s.cbp_landline_amt || 0) +
          Number(s.cbp_gsm_amt || 0) +
          Number(s.ctop_recharge_amt || 0) +
          Number(s.frc_amt || 0) +
          Number(s.mnp_amt || 0) +
          Number(s.sim_replacement_amt || 0) +
          Number(s.sim_fancy_amt || 0) +
          Number(s.sim_postpaid_amt || 0) +
          Number(s.other_amt || 0) +
          pbTotal;

        return [
          sanitizeCSV(formatToDDMMYYYY(normalizeToYYYYMMDD(s.report_date))),
          sanitizeCSV(loc?.state || "N/A"),
          sanitizeCSV(loc?.center_code || "NO-CODE"),
          sanitizeCSV(loc?.center_name || "N/A"),
          sanitizeCSV(s.active_partners?.partner_name || "N/A"),
          Number(s.cbp_landline_amt || 0),
          Number(s.cbp_gsm_amt || 0),
          Number(s.ctop_recharge_amt || 0),
          Number(s.frc_amt || 0),
          Number(s.mnp_amt || 0),
          Number(s.sim_replacement_amt || 0),
          Number(s.sim_fancy_amt || 0),
          Number(s.sim_postpaid_amt || 0),
          Number(s.other_amt || 0),
          pbTotal,
          gross,
        ].join(",");
      });
      triggerBlobDownload(
        [headers.join(","), ...rows].join("\n"),
        `FastArk_MIS_Telecom_Sales_${dateTag}.csv`
      );
      return;
    }

    if (reportType === "deposits") {
      const headers = [
        "Deposit Date (DD/MM/YYYY)",
        "System Reference Code",
        "State",
        "Center Code",
        "Center Name",
        "Partner Name",
        "Stream",
        "Method",
        "Unique UTR No",
        "Transaction ID",
        "Amount (INR)",
        "Audit Status",
        "Remarks / Exemption",
      ];
      const rows = filteredDeposits.map((d) => {
        const locData = d.active_partners?.locations;
        const loc: any = Array.isArray(locData) ? locData[0] : locData;
        const isAadhaarDep =
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
          `${isAadhaarDep ? "FA-ADH" : "FA-DEP"}-${String(d.id || "")
            .slice(0, 6)
            .toUpperCase()}`;

        return [
          sanitizeCSV(
            formatToDDMMYYYY(
              normalizeToYYYYMMDD(d.deposit_date || d.created_at)
            )
          ),
          sanitizeCSV(refCode),
          sanitizeCSV(loc?.state || "N/A"),
          sanitizeCSV(loc?.center_code || "NO-CODE"),
          sanitizeCSV(loc?.center_name || "N/A"),
          sanitizeCSV(d.active_partners?.partner_name || "N/A"),
          sanitizeCSV(
            isAadhaarDep ? "AADHAAR KENDRA" : "TELECOM & PAYBULL"
          ),
          sanitizeCSV(d.deposit_method),
          sanitizeCSV(cleanUtr || "N/A"),
          sanitizeCSV(cleanTxn || "N/A"),
          Number(d.deposit_amount || 0),
          sanitizeCSV(d.status),
          sanitizeCSV(d.rejection_reason || d.exemption_reason || ""),
        ].join(",");
      });
      triggerBlobDownload(
        [headers.join(","), ...rows].join("\n"),
        `FastArk_MIS_Deposits_${dateTag}.csv`
      );
      return;
    }

    if (reportType === "consolidated") {
      const headers = [
        "Date Window",
        "State",
        "Center Code",
        "Center Name",
        "Partner Name",
        "Role",
        "UIDAI Operator ID",
        "UIDAI Station ID",
        "BSNL Telecom Cash (INR)",
        "Paybull Cash (INR)",
        "Aadhaar Kendra Cash (INR)",
        "Unpaid Aadhaar Fines (INR)",
        "Total Cash Generated (INR)",
        "Total Remitted (INR)",
        "Net Closing Pending Due (INR)",
      ];
      const rows = consolidatedPartnerMatrix.map((c) =>
        [
          sanitizeCSV(
            `${formatToDDMMYYYY(fromDate)} to ${formatToDDMMYYYY(toDate)}`
          ),
          sanitizeCSV(c.state),
          sanitizeCSV(c.center_code),
          sanitizeCSV(c.center_name),
          sanitizeCSV(c.partner_name),
          sanitizeCSV(c.role),
          sanitizeCSV(c.operator_id),
          sanitizeCSV(c.station_id),
          c.telecomCash.toFixed(2),
          c.paybullCash.toFixed(2),
          c.aadhaarCash.toFixed(2),
          c.unpaidPenalties.toFixed(2),
          c.totalGenerated.toFixed(2),
          c.totalRemitted.toFixed(2),
          c.netClosingDue.toFixed(2),
        ].join(",")
      );
      triggerBlobDownload(
        [headers.join(","), ...rows].join("\n"),
        `FastArk_MIS_Consolidated_Ledger_${dateTag}.csv`
      );
    }
  };

  const triggerBlobDownload = (csvContent: string, fileName: string) => {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
  };

  const selectedOperatorObj = operatorOptions.find((op) => op.id === fPartner);
  const pdfScopeLabel = `State:${fState} | Center:${fCenter} | Station:${fStation} | Operator:${
    selectedOperatorObj
      ? `${selectedOperatorObj.partner_name} (${selectedOperatorObj.aadhaar_operator_id})`
      : "ALL"
  }`;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-[1500px] mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-6 gap-4">
          <div>
            <Link
              href="/dashboard"
              className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-block"
            >
              &larr; Back to Command Center
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">📈</span> Corporate MIS &amp;
              Multi-Stream Export Hub
            </h1>
            <p className="text-slate-500 font-medium mt-1">
              Generate Station-wise, Operator-wise, and Center-wise financial
              exports ({formatToDDMMYYYY(fromDate)} to{" "}
              {formatToDDMMYYYY(toDate)}).
            </p>
          </div>

          <button
            onClick={fetchMISData}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 shadow-sm transition"
          >
            ↻ Refresh MIS Streams
          </button>
        </div>

        {/* STREAM SELECTOR TABS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              id: "aadhaar",
              icon: "🆔",
              title: "1. Aadhaar Kendra Reports",
              sub: "Daily, Station-Wise & Operator-Wise",
              count: filteredAadhaar.length,
              activeColor: "border-amber-500 bg-amber-50/60 text-amber-950",
            },
            {
              id: "sales",
              icon: "📡",
              title: "2. Telecom & Paybull Sales",
              sub: "BSNL CBP, CTOP, SIM & Paybull",
              count: filteredSales.length,
              activeColor: "border-blue-600 bg-blue-50/60 text-blue-950",
            },
            {
              id: "deposits",
              icon: "🏦",
              title: "3. Bank Remittances",
              sub: "Ref Code, Unique UTR & Txn ID",
              count: filteredDeposits.length,
              activeColor:
                "border-emerald-600 bg-emerald-50/60 text-emerald-950",
            },
            {
              id: "consolidated",
              icon: "📊",
              title: "4. Consolidated Closing Ledger",
              sub: "All Revenue vs. Net Pending Due",
              count: consolidatedPartnerMatrix.length,
              activeColor: "border-indigo-600 bg-indigo-50/60 text-indigo-950",
            },
          ].map((tab) => {
            const isActive = reportType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setReportType(tab.id as ReportStreamType);
                  setFState("ALL");
                  setFHq("ALL");
                  setFCenter("ALL");
                  setFStation("ALL");
                  setFPartner("ALL");
                  setConfirmDownloadCheck(false);
                }}
                className={`p-4 rounded-xl border-2 text-left transition flex items-start justify-between ${
                  isActive
                    ? `${tab.activeColor} shadow-md`
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <div>
                  <span className="text-2xl">{tab.icon}</span>
                  <h3 className="font-black text-xs uppercase tracking-wider mt-2">
                    {tab.title}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                    {tab.sub}
                  </p>
                </div>
                <span className="bg-slate-900 text-white font-black text-[10px] px-2.5 py-1 rounded-full">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 5-TIER CASCADING FILTER + 7-PRESET DATE DROPDOWN + MANDATORY DOWNLOAD CHECKBOX GATE */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-sm text-slate-900 uppercase tracking-wider">
                {isStrictAadhaarMode
                  ? "🔒 Strict Aadhaar-Mapped 5-Tier Filter (State ➔ HQ ➔ Aadhaar Center ➔ Station ID ➔ Operator)"
                  : "🌐 Network 5-Tier Filter (State ➔ Master HQ ➔ Center ➔ Station ID ➔ Partner)"}
              </h2>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                {centerOptions.length} Center(s) • {stationOptions.length}{" "}
                Station ID(s) • {operatorOptions.length} Operator(s) in current
                cascade
              </p>
            </div>

            {reportType === "aadhaar" && (
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-[10px] font-black uppercase">
                <button
                  type="button"
                  onClick={() => {
                    setAadhaarGroupMode("DAILY_LEDGER");
                    setConfirmDownloadCheck(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    aadhaarGroupMode === "DAILY_LEDGER"
                      ? "bg-slate-900 text-white shadow"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  📋 Daily Ledger ({filteredAadhaar.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAadhaarGroupMode("STATION_WISE");
                    setConfirmDownloadCheck(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    aadhaarGroupMode === "STATION_WISE"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  🖥️ Station ID-Wise ({aadhaarStationWiseMatrix.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAadhaarGroupMode("OPERATOR_WISE");
                    setConfirmDownloadCheck(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    aadhaarGroupMode === "OPERATOR_WISE"
                      ? "bg-emerald-600 text-white shadow"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  👤 Operator-Wise ({aadhaarOperatorWiseMatrix.length})
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                  setFStation("ALL");
                  setFPartner("ALL");
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-600"
              >
                <option value="ALL">All States ({uniqueStates.length})</option>
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
              <label className="block text-[9px] font-black uppercase text-amber-700 mb-1">
                3.{" "}
                {isStrictAadhaarMode
                  ? "Mapped Aadhaar Center [Code]"
                  : "Location / Center [Code]"}
              </label>
              <select
                value={fCenter}
                onChange={(e) => {
                  setFCenter(e.target.value);
                  setFStation("ALL");
                  setFPartner("ALL");
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-amber-200 p-2.5 rounded-lg text-xs font-black bg-amber-50/50 text-slate-900 outline-none focus:border-amber-600"
              >
                <option value="ALL">
                  All Centers ({centerOptions.length})
                </option>
                {centerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.center_code || "NO-CODE"}] {c.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-indigo-700 mb-1">
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
                    Stn: {stn.station_id} [{stn.center_code}] (
                    {stn.operatorCount} Op{stn.operatorCount > 1 ? "s" : ""})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-emerald-700 mb-1">
                5.{" "}
                {isStrictAadhaarMode
                  ? "Approved Operator"
                  : "Operator / Partner"}
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
                    {op.partner_name}{" "}
                    {op.aadhaar_operator_id
                      ? `(${op.aadhaar_operator_id} / Stn:${op.aadhaar_station_id})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
            <div>
              <label className="block text-[9px] font-black uppercase text-indigo-700 mb-1">
                6. Date Range Preset
              </label>
              <select
                value={datePreset}
                onChange={(e) =>
                  handlePresetChange(e.target.value as DatePresetMode)
                }
                className="w-full border-2 border-indigo-200 p-2.5 rounded-lg text-xs font-black bg-indigo-50 text-indigo-950 outline-none focus:border-indigo-600"
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
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
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
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">
                To Date ({formatToDDMMYYYY(toDate)})
              </label>
              <input
                type="date"
                value={toDate}
                max={getISTDateString(0)}
                onChange={(e) => {
                  setDatePreset("custom");
                  setToDate(e.target.value);
                  setConfirmDownloadCheck(false);
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              />
            </div>

            <div>
              {reportType === "aadhaar" ? (
                <>
                  <label className="block text-[9px] font-black uppercase text-blue-700 mb-1">
                    7. Aadhaar File Mode Filter
                  </label>
                  <select
                    value={fFileMode}
                    onChange={(e) => {
                      setFFileMode(e.target.value as any);
                      setConfirmDownloadCheck(false);
                    }}
                    className="w-full border-2 border-blue-200 p-2.5 rounded-lg text-xs font-black bg-blue-50 text-blue-950 outline-none"
                  >
                    <option value="ALL">
                      📋 Both (With &amp; Without Files)
                    </option>
                    <option value="WITH_FILES">
                      ✅ With CSV &amp; HTML Files Only
                    </option>
                    <option value="WITHOUT_FILES">
                      ⚠️ Without Files (Manual/Exemption)
                    </option>
                  </select>
                </>
              ) : reportType === "deposits" ? (
                <>
                  <label className="block text-[9px] font-black uppercase text-emerald-700 mb-1">
                    7. Deposit Audit Status
                  </label>
                  <select
                    value={fDepositStatus}
                    onChange={(e) => {
                      setFDepositStatus(e.target.value as any);
                      setConfirmDownloadCheck(false);
                    }}
                    className="w-full border-2 border-emerald-200 p-2.5 rounded-lg text-xs font-black bg-emerald-50 text-emerald-950 outline-none"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="Verified">✅ Verified</option>
                    <option value="Pending">⏳ Pending</option>
                    <option value="Discrepancy">❌ Discrepancy</option>
                  </select>
                </>
              ) : (
                <div className="flex flex-col justify-end h-full">
                  <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600 uppercase text-center">
                    Active Records: {activeRowCount}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
            <label className="flex items-center gap-2.5 bg-slate-50 px-3.5 py-2.5 rounded-xl border-2 border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmDownloadCheck}
                disabled={activeRowCount === 0}
                onChange={(e) => setConfirmDownloadCheck(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-xs font-bold text-slate-800">
                I confirm the selected filter details (Window:{" "}
                <strong>
                  {formatToDDMMYYYY(fromDate)} to {formatToDDMMYYYY(toDate)}
                </strong>{" "}
                • Station: <strong className="text-indigo-700">{fStation}</strong>{" "}
                • <strong>{activeRowCount} matching rows</strong>) and request
                report download.
              </span>
            </label>

            <div className="flex flex-wrap gap-2 w-full xl:w-auto">
              {reportType === "aadhaar" &&
                aadhaarGroupMode === "DAILY_LEDGER" && (
                  <button
                    type="button"
                    disabled={!isDownloadReady}
                    onClick={() =>
                      downloadAadhaarPDFReport(
                        filteredAadhaar,
                        fFileMode,
                        pdfScopeLabel
                      )
                    }
                    className="flex-1 xl:flex-none bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black px-5 py-2.5 rounded-xl text-xs uppercase tracking-widest shadow transition"
                  >
                    📄 Download Aadhaar PDF
                  </button>
                )}

              <button
                type="button"
                disabled={!isDownloadReady}
                onClick={handleExecuteCSVExport}
                className="flex-1 xl:flex-none bg-slate-900 hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black px-5 py-2.5 rounded-xl text-xs uppercase tracking-widest shadow transition"
              >
                📊 Download{" "}
                {reportType === "aadhaar" && aadhaarGroupMode === "STATION_WISE"
                  ? "Station-Wise CSV"
                  : reportType === "aadhaar" &&
                    aadhaarGroupMode === "OPERATOR_WISE"
                  ? "Operator-Wise CSV"
                  : "Filtered CSV"}
              </button>
            </div>
          </div>
        </div>

        {/* LIVE PREVIEW TABLE FOR SELECTED STREAM */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
            <h3 className="font-black text-xs uppercase tracking-widest text-amber-400">
              {reportType === "aadhaar"
                ? `🆔 Aadhaar Kendra Preview — ${aadhaarGroupMode.replace(
                    "_",
                    " "
                  )} (${activeRowCount} Rows)`
                : reportType === "sales"
                ? `📡 Telecom & Paybull Sales Preview (${activeRowCount} Rows)`
                : reportType === "deposits"
                ? `🏦 Bank Remittances Preview (${activeRowCount} Rows)`
                : `📊 Consolidated Partner Closing Ledger (${activeRowCount} Partners)`}
            </h3>
            <span className="text-[10px] font-bold text-slate-300">
              {isDownloadReady
                ? "✅ Download Unlocked"
                : "🔒 Tick Confirmation Box Above to Unlock Download"}
            </span>
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            {reportType === "aadhaar" && aadhaarGroupMode === "DAILY_LEDGER" && (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b sticky top-0">
                  <tr>
                    <th className="p-3.5">Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Aadhaar Center [Code]</th>
                    <th className="p-3.5">Operator &amp; Station ID</th>
                    <th className="p-3.5 text-center">New</th>
                    <th className="p-3.5 text-center">MBU(F)</th>
                    <th className="p-3.5 text-center">MBU(P)</th>
                    <th className="p-3.5 text-center">Demo</th>
                    <th className="p-3.5 text-center">Bio</th>
                    <th className="p-3.5 text-center">Total Pkts</th>
                    <th className="p-3.5 text-right">Cash (₹)</th>
                    <th className="p-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAadhaar.map((r) => {
                    const locData = r.active_partners?.locations;
                    const loc: any = Array.isArray(locData)
                      ? locData[0]
                      : locData;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-black">
                          {formatToDDMMYYYY(r.report_date)}
                        </td>
                        <td className="p-3.5 font-bold">
                          [{loc?.center_code || "NO-CODE"}] {loc?.center_name}
                        </td>
                        <td className="p-3.5">
                          <span className="font-black text-slate-900">
                            {r.active_partners?.partner_name}
                          </span>
                          <span className="text-[10px] font-bold text-indigo-700 block">
                            Op: {r.operator_id} | Stn: {r.station_id}
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-bold">
                          {r.cat1_new_qty}
                        </td>
                        <td className="p-3.5 text-center font-bold">
                          {r.cat2_mbu_free_qty}
                        </td>
                        <td className="p-3.5 text-center font-bold text-amber-700">
                          {r.cat3_mbu_chargeable_qty}
                        </td>
                        <td className="p-3.5 text-center font-bold text-blue-700">
                          {r.cat4_demographic_qty}
                        </td>
                        <td className="p-3.5 text-center font-bold text-purple-700">
                          {r.cat5_biometric_qty}
                        </td>
                        <td className="p-3.5 text-center font-black">
                          {r.total_packets_qty}
                        </td>
                        <td className="p-3.5 text-right font-black text-emerald-700">
                          ₹
                          {Number(r.total_cash_collected).toLocaleString(
                            "en-IN"
                          )}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {reportType === "aadhaar" && aadhaarGroupMode === "STATION_WISE" && (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b sticky top-0">
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
                  {aadhaarStationWiseMatrix.map((s: any) => (
                    <tr key={s.station_id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black text-indigo-700 text-sm">
                        Stn: {s.station_id}
                      </td>
                      <td className="p-3.5 font-bold">
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
            )}

            {reportType === "aadhaar" &&
              aadhaarGroupMode === "OPERATOR_WISE" && (
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b sticky top-0">
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
                    {aadhaarOperatorWiseMatrix.map((o: any) => (
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

            {reportType === "sales" && (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b sticky top-0">
                  <tr>
                    <th className="p-3.5">Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Center [Code] &amp; Partner</th>
                    <th className="p-3.5 text-right">BSNL CBP/CTOP</th>
                    <th className="p-3.5 text-right">BSNL SIM/FRC/MNP</th>
                    <th className="p-3.5 text-right">Paybull Cash</th>
                    <th className="p-3.5 text-right">Total Gross (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredSales.map((s) => {
                    const locData = s.active_partners?.locations;
                    const loc: any = Array.isArray(locData)
                      ? locData[0]
                      : locData;
                    const cbpCtop =
                      Number(s.cbp_landline_amt || 0) +
                      Number(s.cbp_gsm_amt || 0) +
                      Number(s.ctop_recharge_amt || 0);
                    const simAmt =
                      Number(s.sim_replacement_amt || 0) +
                      Number(s.sim_fancy_amt || 0) +
                      Number(s.sim_postpaid_amt || 0) +
                      Number(s.other_amt || 0) +
                      Number(s.frc_amt || 0) +
                      Number(s.mnp_amt || 0);
                    const pbAmt =
                      Number(s.pb_cbp_amt || 0) +
                      Number(s.pb_ctop_amt || 0) +
                      Number(s.pb_frc_amt || 0) +
                      Number(s.pb_mnp_amt || 0) +
                      Number(s.pb_other_amt || 0);

                    return (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-black">
                          {formatToDDMMYYYY(normalizeToYYYYMMDD(s.report_date))}
                        </td>
                        <td className="p-3.5">
                          <span className="font-black text-slate-900">
                            {s.active_partners?.partner_name}
                          </span>
                          <span className="text-[10px] text-slate-500 font-bold block">
                            [{loc?.center_code || "NO-CODE"}] {loc?.center_name}
                          </span>
                        </td>
                        <td className="p-3.5 text-right font-bold">
                          ₹{cbpCtop.toLocaleString("en-IN")}
                        </td>
                        <td className="p-3.5 text-right font-bold">
                          ₹{simAmt.toLocaleString("en-IN")}
                        </td>
                        <td className="p-3.5 text-right font-bold text-indigo-700">
                          ₹{pbAmt.toLocaleString("en-IN")}
                        </td>
                        <td className="p-3.5 text-right font-black text-emerald-700">
                          ₹{(cbpCtop + simAmt + pbAmt).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* 3. BANK REMITTANCES PREVIEW (WITH REF CODE, UNIQUE UTR & TXN ID) */}
            {reportType === "deposits" && (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b sticky top-0">
                  <tr>
                    <th className="p-3.5">Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Reference Code</th>
                    <th className="p-3.5">Center [Code] &amp; Partner</th>
                    <th className="p-3.5">Stream &amp; Method</th>
                    <th className="p-3.5">Unique UTR No</th>
                    <th className="p-3.5">Transaction ID</th>
                    <th className="p-3.5 text-right">Amount (₹)</th>
                    <th className="p-3.5 text-center">Audit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredDeposits.map((d) => {
                    const locData = d.active_partners?.locations;
                    const loc: any = Array.isArray(locData)
                      ? locData[0]
                      : locData;
                    const isAadhaarDep =
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
                      `${isAadhaarDep ? "FA-ADH" : "FA-DEP"}-${String(
                        d.id || ""
                      )
                        .slice(0, 6)
                        .toUpperCase()}`;

                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-black">
                          {formatToDDMMYYYY(
                            normalizeToYYYYMMDD(d.deposit_date || d.created_at)
                          )}
                        </td>
                        <td className="p-3.5 font-mono font-black text-indigo-700">
                          {refCode}
                        </td>
                        <td className="p-3.5">
                          <span className="font-black text-slate-900">
                            {d.active_partners?.partner_name}
                          </span>
                          <span className="text-[10px] text-slate-500 font-bold block">
                            [{loc?.center_code || "NO-CODE"}] {loc?.center_name}
                          </span>
                        </td>
                        <td className="p-3.5 font-bold">
                          {isAadhaarDep ? "🆔 Aadhaar" : "📡 Telecom"} •{" "}
                          {d.deposit_method}
                        </td>
                        <td className="p-3.5 font-black text-slate-900">
                          {cleanUtr}
                        </td>
                        <td className="p-3.5 font-bold text-slate-600">
                          {cleanTxn}
                        </td>
                        <td className="p-3.5 text-right font-black">
                          ₹{Number(d.deposit_amount || 0).toLocaleString("en-IN")}
                        </td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              d.status === "Verified"
                                ? "bg-emerald-100 text-emerald-800"
                                : d.status === "Discrepancy"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {reportType === "consolidated" && (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b sticky top-0">
                  <tr>
                    <th className="p-3.5">Center [Code] &amp; Partner</th>
                    <th className="p-3.5">Operator / Station ID</th>
                    <th className="p-3.5 text-right">Telecom Cash</th>
                    <th className="p-3.5 text-right">Paybull Cash</th>
                    <th className="p-3.5 text-right">Aadhaar Cash</th>
                    <th className="p-3.5 text-right">Unpaid Fines</th>
                    <th className="p-3.5 text-right">Total Generated</th>
                    <th className="p-3.5 text-right">Total Remitted</th>
                    <th className="p-3.5 text-right">Net Pending Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {consolidatedPartnerMatrix.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="p-3.5">
                        <span className="font-black text-slate-900">
                          {c.partner_name}
                        </span>
                        <span className="text-[10px] text-slate-500 font-bold block">
                          [{c.center_code}] {c.center_name} ({c.state})
                        </span>
                      </td>
                      <td className="p-3.5 font-bold text-slate-700">
                        {c.operator_id} / {c.station_id}
                      </td>
                      <td className="p-3.5 text-right font-bold">
                        ₹{c.telecomCash.toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-bold text-indigo-700">
                        ₹{c.paybullCash.toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-bold text-amber-700">
                        ₹{c.aadhaarCash.toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-bold text-red-500">
                        ₹{c.unpaidPenalties.toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-black">
                        ₹{c.totalGenerated.toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-black text-emerald-700">
                        ₹{c.totalRemitted.toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-black text-red-600">
                        ₹{c.netClosingDue.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeRowCount === 0 && (
              <div className="p-12 text-center text-slate-400 font-bold">
                No records match the selected Station/Operator cascade and date
                range.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}