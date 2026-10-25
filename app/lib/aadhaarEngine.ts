// FILE PATH: ./app/lib/aadhaarEngine.ts
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const sanitizePdfText = (val: unknown): string =>
  String(val ?? "").replace(/[^\x20-\x7E]/g, " ");

// --- STRICT INDIAN STANDARD DATE FORMATTERS (DD/MM/YYYY) ---
export const getISTDateString = (offsetDays = 0): string => {
  const now = new Date();
  const istTime = new Date(
    now.getTime() + (330 + now.getTimezoneOffset()) * 60000
  );
  if (offsetDays !== 0) istTime.setDate(istTime.getDate() + offsetDays);
  const y = istTime.getFullYear();
  const m = String(istTime.getMonth() + 1).padStart(2, "0");
  const d = String(istTime.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const formatToDDMMYYYY = (yyyy_mm_dd: string): string => {
  if (!yyyy_mm_dd) return "";
  const clean = yyyy_mm_dd.split("T")[0];
  const parts = clean.split("-");
  if (parts.length !== 3) return yyyy_mm_dd;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

export const convertDDMMYYYYtoYYYYMMDD = (dd_mm_yyyy: string): string => {
  const parts = dd_mm_yyyy.trim().split("/");
  if (parts.length !== 3) return dd_mm_yyyy;
  return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
    2,
    "0"
  )}`;
};

// --- SHARED 7-OPTION DATE PRESET ENGINE (IST SAFE) ---
export type DatePresetMode =
  | "today"
  | "yesterday"
  | "current_week"
  | "current_month"
  | "previous_month"
  | "all"
  | "custom";

export const getDateRangeFromPreset = (
  preset: DatePresetMode
): { start: string; end: string } => {
  const now = new Date();
  const istNow = new Date(
    now.getTime() + (330 + now.getTimezoneOffset()) * 60000
  );

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
    const firstDayPrev = new Date(
      istNow.getFullYear(),
      istNow.getMonth() - 1,
      1
    );
    const lastDayPrev = new Date(istNow.getFullYear(), istNow.getMonth(), 0);
    return { start: formatYMD(firstDayPrev), end: formatYMD(lastDayPrev) };
  }
  if (preset === "all") {
    return { start: "2020-01-01", end: todayStr };
  }
  return { start: todayStr, end: todayStr };
};

// Slices YYYYMMDD from 28-char Enrolment ID
export const extractDateFromEID = (eid: string): string => {
  const clean = eid.trim();
  if (clean.length < 22) return "";
  const yyyymmdd = clean.slice(14, 22);
  if (!/^\d{8}$/.test(yyyymmdd)) return "";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(
    6,
    8
  )}`;
};

// Quote-safe CSV line splitter
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

export interface TariffRule {
  new_enrolment_fee: number;
  mbu_free_fee: number;
  mbu_chargeable_fee: number;
  demographic_fee: number;
  biometric_fee: number;
  demo_min_threshold: number;
  demo_max_threshold: number;
  bio_min_threshold: number;
  gst_percent: number;
  daily_late_penalty: number;
}

// --- 5-CATEGORY CLASSIFICATION RULE ENGINE ---
export const classifyEnrollmentRow = (
  type: string,
  mbu: string,
  totalAmt: number,
  tariff: Partial<TariffRule> | any
):
  | "CAT1_NEW"
  | "CAT2_MBU_FREE"
  | "CAT3_MBU_PAID"
  | "CAT4_DEMO"
  | "CAT5_BIO"
  | "INVALID" => {
  const t = type.trim().toUpperCase();
  const m = mbu.trim().toUpperCase();
  const amt = Number(totalAmt);

  const demoMin = Number(tariff?.demo_min_threshold ?? 50);
  const demoMax = Number(tariff?.demo_max_threshold ?? 100);
  const bioMin = Number(tariff?.bio_min_threshold ?? 100);

  if (t === "N" && m === "NO" && amt === 0) return "CAT1_NEW";
  if (t === "U" && m === "YES" && amt === 0) return "CAT2_MBU_FREE";
  if (t === "U" && m === "YES" && amt > 0) return "CAT3_MBU_PAID";
  if (t === "U" && m === "NO" && amt > demoMin && amt < demoMax)
    return "CAT4_DEMO";
  if (t === "U" && m === "NO" && amt >= bioMin) return "CAT5_BIO";
  return "INVALID";
};

// --- DUAL CSV + HTML PARSER & CROSS-VERIFIER ---
export const parseAndValidateDualFiles = async (
  csvFile: File,
  htmlFile: File,
  mode: "DAILY" | "WEEKLY",
  expectedDateOrRange: {
    reportDate?: string;
    startDate?: string;
    endDate?: string;
  },
  expectedOperatorId: string,
  expectedStationId: string,
  activeTariff: Partial<TariffRule> | any
) => {
  if (!expectedOperatorId.trim() || !expectedStationId.trim()) {
    throw new Error(
      "Profile Not Mapped: Your UIDAI Operator ID and Station ID are not yet mapped to your profile. Please submit your details in '6. Credentials & Upgrade' or contact Admin."
    );
  }

  const [csvText, htmlText] = await Promise.all([
    csvFile.text(),
    htmlFile.text(),
  ]);

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  const metaMap: Record<string, string> = {};
  doc.querySelectorAll(".first_view table tr").forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length >= 2) {
      const key = (tds[0].textContent || "").trim().toLowerCase();
      const val = (tds[1].textContent || "").trim();
      metaMap[key] = val;
    }
  });

  const htmlOperator = (metaMap["operator"] || "").toUpperCase();
  const htmlStation = (metaMap["station id"] || "").trim();
  const pickDateHeader = (
    doc.querySelector(".pick_date h3")?.textContent || ""
  ).trim();

  if (htmlOperator !== expectedOperatorId.trim().toUpperCase()) {
    throw new Error(
      `Operator Mismatch: HTML file belongs to '${htmlOperator}', but your profile is '${expectedOperatorId}'.`
    );
  }
  if (htmlStation !== expectedStationId.trim()) {
    throw new Error(
      `Station ID Mismatch: HTML file belongs to Station '${htmlStation}', but your assigned Station is '${expectedStationId}'.`
    );
  }

  const dateMatches = pickDateHeader.match(
    /(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i
  );
  if (!dateMatches) {
    throw new Error(
      "Invalid HTML Report: Could not locate 'Report Generated for Date: DD/MM/YYYY to DD/MM/YYYY' header."
    );
  }
  const htmlFromYYYYMMDD = convertDDMMYYYYtoYYYYMMDD(dateMatches[1]);
  const htmlToYYYYMMDD = convertDDMMYYYYtoYYYYMMDD(dateMatches[2]);

  if (mode === "DAILY") {
    if (
      htmlFromYYYYMMDD !== expectedDateOrRange.reportDate ||
      htmlToYYYYMMDD !== expectedDateOrRange.reportDate
    ) {
      throw new Error(
        `Date Mismatch: Selected date is ${formatToDDMMYYYY(
          expectedDateOrRange.reportDate!
        )}, but HTML report was generated for ${dateMatches[1]} to ${
          dateMatches[2]
        }.`
      );
    }
  } else {
    if (
      htmlFromYYYYMMDD !== expectedDateOrRange.startDate ||
      htmlToYYYYMMDD !== expectedDateOrRange.endDate
    ) {
      throw new Error(
        `Weekly Date Range Mismatch: Selected ${formatToDDMMYYYY(
          expectedDateOrRange.startDate!
        )} to ${formatToDDMMYYYY(
          expectedDateOrRange.endDate!
        )}, but HTML file is for ${dateMatches[1]} to ${dateMatches[2]}.`
      );
    }
  }

  const htmlRows: any[] = [];
  doc.querySelectorAll(".details_view table tbody tr").forEach((tr) => {
    const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
      (td.textContent || "").trim()
    );
    if (tds.length >= 19) {
      htmlRows.push({
        sno: tds[0],
        eid: tds[1],
        type: tds[3],
        mbu: tds[4],
        operator: tds[7],
        status: tds[12],
        gstPct: parseFloat(tds[15]) || 0,
        newAmt: parseFloat(tds[16]) || 0,
        updateAmt: parseFloat(tds[17]) || 0,
        totalAmt: parseFloat(tds[18]) || 0,
      });
    }
  });

  const csvLines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (csvLines.length < 2)
    throw new Error("CSV file is empty or missing headers.");

  const csvRows = csvLines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    return {
      sno: (cols[0] || "").trim(),
      eid: (cols[1] || "").trim(),
      type: (cols[3] || "").trim(),
      mbu: (cols[4] || "").trim(),
      operator: (cols[7] || "").trim(),
      status: (cols[11] || "").trim(),
      gstPct: parseFloat(cols[12]) || 0,
      newAmt: parseFloat(cols[13]) || 0,
      updateAmt: parseFloat(cols[14]) || 0,
      totalAmt: parseFloat(cols[15]) || 0,
    };
  });

  if (csvRows.length !== htmlRows.length) {
    throw new Error(
      `File Parity Error: CSV contains ${csvRows.length} rows, but HTML contains ${htmlRows.length} rows. Both files must match.`
    );
  }

  let cat1_new_qty = 0,
    cat2_mbu_free_qty = 0,
    cat3_mbu_chargeable_qty = 0,
    cat4_demographic_qty = 0,
    cat5_biometric_qty = 0;
  let completed_qty = 0,
    inprocess_qty = 0,
    rejected_qty = 0;
  let base_amount = 0,
    total_cash_collected = 0;

  const dailyBuckets: Record<
    string,
    {
      date: string;
      cat1: number;
      cat2: number;
      cat3: number;
      cat4: number;
      cat5: number;
      totalPkts: number;
      completed: number;
      inprocess: number;
      rejected: number;
      totalCash: number;
    }
  > = {};

  for (let i = 0; i < csvRows.length; i++) {
    const c = csvRows[i];
    const h = htmlRows[i];

    if (
      c.eid !== h.eid ||
      c.type !== h.type ||
      c.mbu !== h.mbu ||
      Math.abs(c.totalAmt - h.totalAmt) > 0.01
    ) {
      throw new Error(
        `Row #${i + 1} Mismatch (${
          c.eid
        }): CSV and HTML values do not match. Ensure both files are from the exact same export.`
      );
    }

    const eidDate = extractDateFromEID(c.eid);
    if (mode === "DAILY" && eidDate !== expectedDateOrRange.reportDate) {
      throw new Error(
        `Packet Date Mismatch on Row #${i + 1} (${
          c.eid
        }): Packet date is ${formatToDDMMYYYY(
          eidDate
        )}, expected ${formatToDDMMYYYY(expectedDateOrRange.reportDate!)}.`
      );
    }

    const cat = classifyEnrollmentRow(c.type, c.mbu, c.totalAmt, activeTariff);
    if (cat === "INVALID") {
      throw new Error(
        `Unrecognized UIDAI Category on Row #${i + 1} (${c.eid}): Type=${
          c.type
        }, MBU=${c.mbu}, Amt=₹${c.totalAmt}.`
      );
    }

    const st = c.status.toUpperCase();
    if (st.includes("REJECT")) rejected_qty++;
    else if (st.includes("COMPLETE")) completed_qty++;
    else inprocess_qty++;

    if (cat === "CAT1_NEW") cat1_new_qty++;
    else if (cat === "CAT2_MBU_FREE") cat2_mbu_free_qty++;
    else if (cat === "CAT3_MBU_PAID") cat3_mbu_chargeable_qty++;
    else if (cat === "CAT4_DEMO") cat4_demographic_qty++;
    else if (cat === "CAT5_BIO") cat5_biometric_qty++;

    base_amount += c.newAmt + c.updateAmt;
    total_cash_collected += c.totalAmt;

    if (!dailyBuckets[eidDate]) {
      dailyBuckets[eidDate] = {
        date: eidDate,
        cat1: 0,
        cat2: 0,
        cat3: 0,
        cat4: 0,
        cat5: 0,
        totalPkts: 0,
        completed: 0,
        inprocess: 0,
        rejected: 0,
        totalCash: 0,
      };
    }
    const b = dailyBuckets[eidDate];
    b.totalPkts++;
    b.totalCash += c.totalAmt;
    if (cat === "CAT1_NEW") b.cat1++;
    if (cat === "CAT2_MBU_FREE") b.cat2++;
    if (cat === "CAT3_MBU_PAID") b.cat3++;
    if (cat === "CAT4_DEMO") b.cat4++;
    if (cat === "CAT5_BIO") b.cat5++;
    if (st.includes("REJECT")) b.rejected++;
    else if (st.includes("COMPLETE")) b.completed++;
    else b.inprocess++;
  }

  const gst_amount = Math.max(0, total_cash_collected - base_amount);

  return {
    operator_id: htmlOperator,
    station_id: htmlStation,
    cat1_new_qty,
    cat2_mbu_free_qty,
    cat3_mbu_chargeable_qty,
    cat4_demographic_qty,
    cat5_biometric_qty,
    total_packets_qty: csvRows.length,
    completed_qty,
    inprocess_qty,
    rejected_qty,
    base_amount: Number(base_amount.toFixed(2)),
    gst_amount: Number(gst_amount.toFixed(2)),
    total_cash_collected: Number(total_cash_collected.toFixed(2)),
    daily_breakdown: Object.values(dailyBuckets).sort((a, b) =>
      a.date.localeCompare(b.date)
    ),
  };
};

// --- AUTOMATED LATE PAYMENT PENALTY SYNC ENGINE (UTC-SAFE CALENDAR ARITHMETIC) ---
export const syncAadhaarLatePenalties = async (
  supabase: any,
  partnerId: string
) => {
  const todayIST = getISTDateString(0);

  const [overdueRes, tariffRes, existingPenRes] = await Promise.all([
    supabase
      .from("aadhaar_daily_reports")
      .select("id, report_date, total_cash_collected, deposit_status")
      .eq("partner_id", partnerId)
      .eq("deposit_status", "Pending Deposit")
      .gt("total_cash_collected", 0)
      .lt("report_date", todayIST),
    supabase
      .from("aadhaar_tariff_history")
      .select("daily_late_penalty")
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("aadhaar_penalty_logs")
      .select("daily_report_id, penalty_for_date, is_waived, is_settled")
      .eq("partner_id", partnerId),
  ]);

  const overdueReports = overdueRes.data;
  if (!overdueReports || overdueReports.length === 0) return;

  const existingKeys = new Set(
    (existingPenRes.data || []).map(
      (p: any) => `${p.daily_report_id}_${p.penalty_for_date}`
    )
  );

  const penaltyRate = Number(tariffRes.data?.daily_late_penalty || 100.0);

  for (const rep of overdueReports) {
    // Use UTC midnight on YYYY-MM-DD strings so adding 86400000ms never shifts dates backward by 5.5h
    const repDateUTC = new Date(`${rep.report_date}T00:00:00Z`);
    const curDateUTC = new Date(`${todayIST}T00:00:00Z`);
    const diffDays = Math.floor(
      (curDateUTC.getTime() - repDateUTC.getTime()) / 86400000
    );

    if (diffDays <= 0) continue;

    for (let d = 1; d <= diffDays; d++) {
      const penaltyDateObj = new Date(repDateUTC.getTime() + d * 86400000);
      const pDateStr = penaltyDateObj.toISOString().split("T")[0];
      const compositeKey = `${rep.id}_${pDateStr}`;

      if (existingKeys.has(compositeKey)) continue;

      const { data: inserted, error } = await supabase
        .from("aadhaar_penalty_logs")
        .insert([
          {
            partner_id: partnerId,
            daily_report_id: rep.id,
            report_date: rep.report_date,
            penalty_for_date: pDateStr,
            penalty_amount: penaltyRate,
          },
        ])
        .select()
        .maybeSingle();

      if (inserted && !error) {
        existingKeys.add(compositeKey);
        await supabase.from("partner_messages").insert([
          {
            partner_id: partnerId,
            subject: `🚨 LATE DEPOSIT PENALTY (₹${penaltyRate}): Aadhaar Report ${formatToDDMMYYYY(
              rep.report_date
            )}`,
            body: `Your Aadhaar cash collection of ₹${Number(
              rep.total_cash_collected
            ).toLocaleString("en-IN")} for ${formatToDDMMYYYY(
              rep.report_date
            )} was not deposited before closing. A late payment penalty of ₹${penaltyRate.toFixed(
              2
            )} (Day ${d}) has been added to your pending balance ledger for ${formatToDDMMYYYY(
              pDateStr
            )}. Please scan and pay immediately.`,
          },
        ]);
      }
    }
  }
};

// --- MULTI-FORMAT EXPORT ENGINE (CSV & OFFICIAL A4 PDF) ---
export const downloadAadhaarCSVReport = (
  reports: any[],
  filterLabel: string
) => {
  if (reports.length === 0)
    return alert("No records available to export for the current filter.");

  const headers = [
    "Report Date (DD/MM/YYYY)",
    "Operator ID",
    "Station ID",
    "Submission Mode",
    "1. New Enrolment",
    "2. MBU Free",
    "3. MBU Chargeable",
    "4. Demographic Update",
    "5. Biometric Update",
    "Total Packets",
    "Completed",
    "InProcess",
    "Rejected",
    "Base Fee (INR)",
    "GST 18% (INR)",
    "Total Cash Collected (INR)",
    "Deposit Status",
    "Exemption / Remarks",
  ];

  const sanitize = (val: any) => `"${String(val ?? "").replace(/"/g, '""')}"`;

  const rows = reports.map((r) => [
    sanitize(formatToDDMMYYYY(r.report_date)),
    sanitize(r.operator_id),
    sanitize(r.station_id),
    sanitize(
      r.has_files
        ? "With CSV & HTML Files"
        : "Without Files (Manual/Exemption)"
    ),
    r.cat1_new_qty || 0,
    r.cat2_mbu_free_qty || 0,
    r.cat3_mbu_chargeable_qty || 0,
    r.cat4_demographic_qty || 0,
    r.cat5_biometric_qty || 0,
    r.total_packets_qty || 0,
    r.completed_qty || 0,
    r.inprocess_qty || 0,
    r.rejected_qty || 0,
    r.base_amount || 0,
    r.gst_amount || 0,
    r.total_cash_collected || 0,
    sanitize(r.deposit_status),
    sanitize(r.exemption_reason || "Verified File Upload"),
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `FastArk_Aadhaar_${filterLabel}_${formatToDDMMYYYY(
    getISTDateString()
  ).replace(/\//g, "-")}.csv`;
  link.click();
};

export const downloadAadhaarPDFReport = async (
  reports: any[],
  filterLabel: string,
  titleMeta: string
) => {
  if (reports.length === 0)
    return alert("No records available to export for the current filter.");

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([841.89, 595.28]);
  let y = 550;

  const drawHeader = () => {
    page.drawRectangle({
      x: 0,
      y: 535,
      width: 841.89,
      height: 60,
      color: rgb(0.06, 0.09, 0.16),
    });
    page.drawText(
      "FAST ARK PRIVATE LIMITED - AADHAAR SEVA KENDRA AUDIT LEDGER",
      {
        x: 30,
        y: 565,
        size: 14,
        font: bold,
        color: rgb(1, 1, 1),
      }
    );
    page.drawText(
      sanitizePdfText(
        `Filter Mode: ${filterLabel.toUpperCase()}   |   Scope: ${titleMeta}   |   Generated: ${formatToDDMMYYYY(
          getISTDateString()
        )}`
      ).slice(0, 125),
      {
        x: 30,
        y: 547,
        size: 9,
        font: font,
        color: rgb(0.7, 0.8, 1),
      }
    );

    y = 510;
    const cols = [
      { text: "Date", x: 30 },
      { text: "Operator / Stn", x: 100 },
      { text: "Mode", x: 205 },
      { text: "New", x: 280 },
      { text: "MBU(F)", x: 320 },
      { text: "MBU(P)", x: 370 },
      { text: "Demo", x: 420 },
      { text: "Bio", x: 465 },
      { text: "Total", x: 505 },
      { text: "Base (Rs)", x: 555 },
      { text: "GST (Rs)", x: 625 },
      { text: "Cash (Rs)", x: 690 },
      { text: "Status", x: 760 },
    ];
    page.drawRectangle({
      x: 25,
      y: y - 5,
      width: 790,
      height: 20,
      color: rgb(0.92, 0.94, 0.97),
    });
    cols.forEach((c) =>
      page.drawText(c.text, {
        x: c.x,
        y: y,
        size: 8,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
      })
    );
    y -= 22;
  };

  drawHeader();

  let grandPkts = 0,
    grandCash = 0;

  for (const r of reports) {
    if (y < 50) {
      page = pdfDoc.addPage([841.89, 595.28]);
      drawHeader();
    }

    grandPkts += Number(r.total_packets_qty || 0);
    grandCash += Number(r.total_cash_collected || 0);

    page.drawText(sanitizePdfText(formatToDDMMYYYY(r.report_date)), {
      x: 30,
      y,
      size: 8,
      font: bold,
    });
    page.drawText(
      sanitizePdfText(`${r.operator_id} (${r.station_id})`).slice(0, 18),
      {
        x: 100,
        y,
        size: 8,
        font,
      }
    );
    page.drawText(r.has_files ? "CSV+HTML" : "Manual/Exemp", {
      x: 205,
      y,
      size: 8,
      font,
    });
    page.drawText(String(r.cat1_new_qty || 0), { x: 280, y, size: 8, font });
    page.drawText(String(r.cat2_mbu_free_qty || 0), {
      x: 320,
      y,
      size: 8,
      font,
    });
    page.drawText(String(r.cat3_mbu_chargeable_qty || 0), {
      x: 370,
      y,
      size: 8,
      font,
    });
    page.drawText(String(r.cat4_demographic_qty || 0), {
      x: 420,
      y,
      size: 8,
      font,
    });
    page.drawText(String(r.cat5_biometric_qty || 0), {
      x: 465,
      y,
      size: 8,
      font,
    });
    page.drawText(String(r.total_packets_qty || 0), {
      x: 505,
      y,
      size: 8,
      font: bold,
    });
    page.drawText(Number(r.base_amount || 0).toFixed(2), {
      x: 555,
      y,
      size: 8,
      font,
    });
    page.drawText(Number(r.gst_amount || 0).toFixed(2), {
      x: 625,
      y,
      size: 8,
      font,
    });
    page.drawText(Number(r.total_cash_collected || 0).toFixed(2), {
      x: 690,
      y,
      size: 8,
      font: bold,
    });
    page.drawText(sanitizePdfText(r.deposit_status || "").slice(0, 12), {
      x: 760,
      y,
      size: 7,
      font,
    });

    y -= 18;
  }

  page.drawRectangle({
    x: 25,
    y: y - 8,
    width: 790,
    height: 24,
    color: rgb(0.06, 0.09, 0.16),
  });
  page.drawText(
    sanitizePdfText(
      `TOTAL PACKETS: ${grandPkts}   |   TOTAL CASH COLLECTED: Rs. ${grandCash.toLocaleString(
        "en-IN",
        { minimumFractionDigits: 2 }
      )}`
    ),
    {
      x: 35,
      y: y,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    }
  );

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes as unknown as BlobPart], {
    type: "application/pdf",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `FastArk_Aadhaar_Report_${filterLabel}_${formatToDDMMYYYY(
    getISTDateString()
  ).replace(/\//g, "-")}.pdf`;
  link.click();
};