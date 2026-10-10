"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CorporateMISReports() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [adminUser, setAdminUser] = useState<any>(null);

  // --- Filtering State ---
  const [exportType, setExportType] = useState("sales");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(1)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0] 
  });
  const [geoFilter, setGeoFilter] = useState({ state: "All", dist: "All", partner_id: "All" });
  
  const [dropdowns, setDropdowns] = useState<{
    states: string[];
    dists: string[];
    partners: { id: string, label: string }[];
  }>({ states: [], dists: [], partners: [] });

  useEffect(() => {
    initializeEngine();
  }, []);

  const initializeEngine = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data: staffData } = await supabase
        .from("back_office_staff")
        .select("id, email, role")
        .eq("email", session.user.email)
        .single();
        
      setAdminUser(staffData || { email: session.user.email });

      const { data: partners } = await supabase
        .from("active_partners")
        .select("id, partner_name, locations (state, dist, center_name)");

      const stNames = new Set<string>();
      const dtNames = new Set<string>();
      const pList: {id: string, label: string}[] = [];

      (partners || []).forEach(p => {
        const locData = p.locations;
        const l: any = Array.isArray(locData) ? locData[0] : locData;

        if (l?.state) stNames.add(l.state);
        if (l?.dist) dtNames.add(l.dist);
        pList.push({ id: p.id, label: `${p.partner_name} (${l?.center_name || 'N/A'})` });
      });

      setDropdowns({
        states: Array.from(stNames).sort(),
        dists: Array.from(dtNames).sort(),
        partners: pList.sort((a, b) => a.label.localeCompare(b.label))
      });

    } catch (err) {
      console.error("Initialization Error:", err);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);

      if (startDate > endDate) {
        alert("Validation Error: Start Date cannot be after End Date.");
        return;
      }

      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      
      if (diffDays > 31) {
        alert("System Warning: Custom reporting is strictly limited to a maximum of 31 days to ensure database stability. Please narrow your date range.");
        return;
      }

      let query = supabase.from(exportType === 'sales' ? 'daily_sales_reports' : 'partner_deposits')
        .select(`*, active_partners (id, partner_name, locations (state, dist, center_name))`);

      if (exportType === 'sales') {
        query = query.gte('report_date', dateRange.start).lte('report_date', dateRange.end).order('report_date', { ascending: false });
      } else {
        query = query.gte('created_at', `${dateRange.start}T00:00:00+05:30`).lte('created_at', `${dateRange.end}T23:59:59+05:30`).order('created_at', { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;

      let filteredData = data || [];

      filteredData = filteredData.filter(row => {
        const p = row.active_partners;
        
        const locData = p?.locations;
        const l: any = Array.isArray(locData) ? locData[0] : locData;

        if (geoFilter.state !== "All" && l?.state !== geoFilter.state) return false;
        if (geoFilter.dist !== "All" && l?.dist !== geoFilter.dist) return false;
        if (geoFilter.partner_id !== "All" && p?.id !== geoFilter.partner_id) return false;

        if (statusFilter !== "All") {
          if (exportType === 'deposits') {
            if (row.status !== statusFilter) return false;
          } else if (exportType === 'sales') {
            if (statusFilter === 'ZeroBiz' && !row.zero_business_reason) return false;
            if (statusFilter === 'Edited' && !row.is_edited_by_staff) return false;
            if (statusFilter === 'Standard' && (row.zero_business_reason || row.is_edited_by_staff)) return false;
          }
        }
        return true;
      });

      if (filteredData.length === 0) {
        alert(`No ${exportType} records found matching your strict filters for the selected period.`);
        return;
      }

      if (adminUser?.email) {
        await supabase.from('staff_activity_logs').insert([{
          staff_id: adminUser.id || 'SYS',
          staff_email: adminUser.email,
          action_type: 'EXPORT',
          module: 'MIS_REPORTS',
          target_id: 'EXCEL_CSV',
          details: `Exported ${filteredData.length} rows of ${exportType.toUpperCase()} data. Range: ${dateRange.start} to ${dateRange.end}. State: ${geoFilter.state}.`
        }]);
      }

      generateCSV(filteredData, exportType);
      
    } catch (err: any) {
      alert("Error generating report: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const sanitizeCSV = (val: unknown): string => {
    let str = String(val || "").replace(/"/g, '""');
    if (/^[=+\-@]/.test(str)) {
      str = "'" + str;
    }
    return `"${str}"`;
  };

  const generateCSV = (data: Record<string, any>[], type: string) => {
    const flatData = data.map(row => {
      const locData = row.active_partners?.locations;
      const l: any = Array.isArray(locData) ? locData[0] : locData;

      const baseRow: Record<string, unknown> = {
        Record_ID: row.id,
        Partner_Name: row.active_partners?.partner_name || 'N/A',
        Center_Name: l?.center_name || 'N/A',
        State: l?.state || 'N/A',
        District: l?.dist || 'N/A',
      };

      if (type === 'sales') {
        const totalCash = Number(row.cbp_landline_amt||0) + Number(row.cbp_gsm_amt||0) + 
                          Number(row.ctop_recharge_amt||0) + Number(row.sim_replacement_amt||0) + 
                          Number(row.sim_fancy_amt||0) + Number(row.sim_postpaid_amt||0) + 
                          Number(row.other_amt||0) + Number(row.frc_amt||0) + Number(row.mnp_amt||0) +
                          Number(row.pb_cbp_amt||0) + Number(row.pb_ctop_amt||0) + Number(row.pb_frc_amt||0) + 
                          Number(row.pb_mnp_amt||0) + Number(row.pb_other_amt||0);

        return {
          ...baseRow,
          Report_Date: row.report_date,
          Total_Gross_Revenue: totalCash,
          Zero_Business_Reason: row.zero_business_reason || '',
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
          Edited_By_Admin: row.is_edited_by_staff ? 'YES' : 'NO',
          Audit_Remarks: row.staff_edit_remarks || ''
        };
      } else {
        return {
          ...baseRow,
          Remittance_Date: new Date(row.created_at).toLocaleDateString('en-IN'),
          Method: row.deposit_method,
          Reference_No: row.reference_no || '',
          Amount_INR: row.deposit_amount,
          Audit_Status: row.status,
          Discrepancy_Remarks: row.rejection_reason || '',
          Exemption_Reason: row.exemption_reason || '',
        };
      }
    });

    if (flatData.length === 0) return;

    const headers = Object.keys(flatData[0]).join(",");
    const csvRows = flatData.map(row => 
      Object.values(row).map(val => sanitizeCSV(val)).join(",") 
    ).join("\n");

    const csvContent = `${headers}\n${csvRows}`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `FastArk_${type.toUpperCase()}_MIS_${dateRange.start}_to_${dateRange.end}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isInitializing) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-[1000px] mx-auto bg-slate-50 min-h-screen font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-200 pb-6 gap-4">
        <div>
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline mb-2 inline-block text-sm">
            &larr; Back to Command Center
          </Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <span className="text-4xl">📈</span> Corporate MIS Export Engine
          </h1>
          <p className="text-slate-500 font-medium mt-1">Generate surgically filtered financial ledgers and operational data (Max 31 Days).</p>
        </div>
      </div>

      <div className="bg-white p-6 md:p-8 rounded-xl border border-slate-200 shadow-sm">
        <form onSubmit={handleExport} className="space-y-8">
          
          {/* STEP 1: MODULE TARGET */}
          <div>
            <label className="block text-slate-700 font-black mb-3 uppercase tracking-widest text-xs border-b border-slate-100 pb-2">1. Select Target Ledger</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className={`border-2 p-4 rounded-xl cursor-pointer transition flex items-center gap-4 shadow-sm ${exportType === 'sales' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                <input type="radio" name="exportType" value="sales" checked={exportType === 'sales'} onChange={(e) => { setExportType(e.target.value); setStatusFilter("All"); }} className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="font-black text-slate-900">Partner Sales Ledger</h3>
                  <p className="text-xs text-slate-500 font-bold mt-0.5">Daily generated cash and stock data</p>
                </div>
              </label>
              
              <label className={`border-2 p-4 rounded-xl cursor-pointer transition flex items-center gap-4 shadow-sm ${exportType === 'deposits' ? 'border-amber-600 bg-amber-50' : 'border-slate-200 hover:border-amber-300'}`}>
                <input type="radio" name="exportType" value="deposits" checked={exportType === 'deposits'} onChange={(e) => { setExportType(e.target.value); setStatusFilter("All"); }} className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="font-black text-slate-900">Cash Remittances</h3>
                  <p className="text-xs text-slate-500 font-bold mt-0.5">Bank deposits and verified discrepancies</p>
                </div>
              </label>
            </div>
          </div>

          {/* STEP 2: TEMPORAL FILTER */}
          <div>
            <label className="block text-slate-700 font-black mb-3 uppercase tracking-widest text-xs border-b border-slate-100 pb-2">2. Define Temporal Range</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Start Date *</label>
                <input type="date" required value={dateRange.start} onChange={(e) => setDateRange({...dateRange, start: e.target.value})} className="w-full border-2 border-slate-300 p-3 rounded-lg outline-none focus:border-indigo-500 font-bold text-slate-700 bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">End Date *</label>
                <input type="date" required value={dateRange.end} max={new Date().toISOString().split('T')[0]} onChange={(e) => setDateRange({...dateRange, end: e.target.value})} className="w-full border-2 border-slate-300 p-3 rounded-lg outline-none focus:border-indigo-500 font-bold text-slate-700 bg-white" />
              </div>
            </div>
          </div>

          {/* STEP 3: GEOGRAPHIC & STATUS FILTERS */}
          <div>
            <label className="block text-slate-700 font-black mb-3 uppercase tracking-widest text-xs border-b border-slate-100 pb-2">3. Drill-Down Filters</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">State</label>
                <select value={geoFilter.state} onChange={e => setGeoFilter({...geoFilter, state: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-3 outline-none focus:border-indigo-500">
                  <option value="All">All States (No Filter)</option>
                  {dropdowns.states.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">District</label>
                <select value={geoFilter.dist} onChange={e => setGeoFilter({...geoFilter, dist: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-3 outline-none focus:border-indigo-500">
                  <option value="All">All Districts (No Filter)</option>
                  {dropdowns.dists.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Specific Partner Target</label>
                <select value={geoFilter.partner_id} onChange={e => setGeoFilter({...geoFilter, partner_id: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-3 outline-none focus:border-indigo-500">
                  <option value="All">All Partners (No Filter)</option>
                  {dropdowns.partners.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Status Filter</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-3 outline-none focus:border-indigo-500">
                  <option value="All">All Records (No Filter)</option>
                  {exportType === 'deposits' ? (
                    <>
                      <option value="Pending">Pending Audit Only</option>
                      <option value="Verified">Verified & Cleared Only</option>
                      <option value="Discrepancy">Rejected Discrepancies Only</option>
                    </>
                  ) : (
                    <>
                      <option value="Standard">Standard Submissions</option>
                      <option value="ZeroBiz">Zero Business Days Only</option>
                      <option value="Edited">Admin Overrides Only</option>
                    </>
                  )}
                </select>
              </div>

            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button type="submit" disabled={loading} className="w-full py-4 bg-slate-900 hover:bg-indigo-600 text-white font-black text-sm uppercase tracking-widest rounded-xl shadow-lg transition disabled:bg-slate-400 disabled:shadow-none flex justify-center items-center gap-3">
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>
                  Generating Extract...
                </>
              ) : (
                <>
                  <span className="text-xl">📥</span> Secure Download CSV
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}