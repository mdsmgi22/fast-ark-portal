export const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

export const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  } 
  if (dateStr.includes('-')) {
    const dateOnly = dateStr.split('T')[0];
    const parts = dateOnly.split('-');
    if (parts[0].length === 4) return dateOnly; 
    if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return dateStr.split('T')[0];
};

export const formatToDDMMYYYY = (dateStr: string) => {
  const yyyymmdd = normalizeToYYYYMMDD(dateStr);
  if (!yyyymmdd.includes('-')) return dateStr;
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}/${m}/${y}`;
};

export const sanitizeCSV = (str: any) => `"${String(str || '').replace(/"/g, '""')}"`;

export const executePartnerSalesCSVExport = (exportData: any[], timeFilter: string) => {
  if (exportData.length === 0) {
    alert("No data to export for this time period.");
    return;
  }

  const headers = [
    "Report Date", "CBP Landline", "CBP GSM", "CTOP Amount", "FRC Amount", "MNP Amount",
    "SIM New Qty", "SIM Upgrade Qty", "SIM Replace Qty", "SIM Replace Amt",
    "Fancy Qty", "Fancy Amt", "Postpaid Qty", "Postpaid Amt", "Paybull Cash", "Other Amount", "Cheque Amount", "Audited Status"
  ];

  const csvContent = [
    headers.join(","),
    ...exportData.map(s => {
      const pbCash = Number(s.pb_cbp_amt||0) + Number(s.pb_ctop_amt||0) + Number(s.pb_frc_amt||0) + Number(s.pb_mnp_amt||0) + Number(s.pb_other_amt||0);
      return [
        sanitizeCSV(formatToDDMMYYYY(s.report_date)),
        s.cbp_landline_amt || 0, s.cbp_gsm_amt || 0, s.ctop_recharge_amt || 0, s.frc_amt || 0, s.mnp_amt || 0,
        s.sim_new_qty || 0, s.sim_upgrade_qty || 0, s.sim_replacement_qty || 0, s.sim_replacement_amt || 0,
        s.sim_fancy_qty || 0, s.sim_fancy_amt || 0, s.sim_postpaid_qty || 0, s.sim_postpaid_amt || 0,
        pbCash, s.other_amt || 0, s.cheque_amt || 0, sanitizeCSV(s.is_edited_by_staff ? "Audited" : "Original")
      ].join(",");
    })
  ].join("\n");

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  
  const todayStr = getLocalDateString(new Date());
  link.download = `FastArk_Sales_${timeFilter}_${formatToDDMMYYYY(todayStr).replace(/\//g, '-')}.csv`;
  link.click();
};