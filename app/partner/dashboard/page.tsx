"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// --- Date Normalizers (IST Safe) ---
const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

const normalizeToYYYYMMDD = (dateStr: string) => {
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

const formatToDDMMYYYY = (dateStr: string) => {
  const yyyymmdd = normalizeToYYYYMMDD(dateStr);
  if (!yyyymmdd.includes('-')) return dateStr;
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}/${m}/${y}`;
};

export default function PartnerDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  
  // --- Profile & Core State ---
  const [partner, setPartner] = useState<any>(null);
  const [partnerCtops, setPartnerCtops] = useState<any[]>([]); 
  
  // --- Alerts & Inbox State ---
  const [messages, setMessages] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);

  // --- Treasury Channels State ---
  const [companyBanks, setCompanyBanks] = useState<any[]>([]);
  const [virtualAccounts, setVirtualAccounts] = useState<any[]>([]);
  const [upiIds, setUpiIds] = useState<any[]>([]);

  // --- Historical Ledger State ---
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);
  
  const [timeFilter, setTimeFilter] = useState("monthly");
  const [hasSubmittedToday, setHasSubmittedToday] = useState(false);
  const [lifetimePendingBalance, setLifetimePendingBalance] = useState(0);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  // Edit Request State
  const [requestingEditId, setRequestingEditId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");

  const [displayLedger, setDisplayLedger] = useState({
    totalCBP: 0, totalCTOP: 0, totalSimCash: 0, totalPostpaidCash: 0, totalOtherCash: 0, 
    totalCheque: 0, totalCashSales: 0, totalDeposits: 0,
    qNew: 0, qUp: 0, qRep: 0, qFan: 0, qPost: 0
  });

  // --- Compliance Document Upload State ---
  const [docFiles, setDocFiles] = useState<Record<string, File | null>>({});
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [hasUploadedDocs, setHasUploadedDocs] = useState(false);
  const [docUploadMessage, setDocUploadMessage] = useState("");

  const getRequiredDocuments = (role: string) => {
    const r = (role || "").toUpperCase();
    if (r.includes("OCSC")) {
      return [
        "Marks Card",
        "Photo with Location GPS Tagged (5 Nos)",
        "HOTO Letter Copy",
        "Police Verification Certificate",
        "Bank Passbook / Cancel Cheque"
      ];
    } else if (r.includes("AADHAAR")) {
      return [
        "Marks Card (12th Pass)",
        "Photo with Location GPS Tagged (5 Nos)",
        "HOTO Letter Copy",
        "Police Verification Certificate",
        "NSEIT Certificate",
        "LMS Certificate",
        "Annexure A & B",
        "L1 Readiness Document",
        "100 Rs BSNL Stamp Undertaking",
        "100 Rs Company Stamp Undertaking",
        "EA Request Form",
        "Bank Passbook / Cancel Cheque"
      ];
    } else {
      return [
        "GST Certificate",
        "Bank Mapping",
        "Other Document 1",
        "Other Document 2",
        "Other Document 3"
      ];
    }
  };

  useEffect(() => {
    initializeDashboard();
  }, [router]);

  const initializeDashboard = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

      // 1. Fetch Partner Profile
      const { data: partnerData, error: partnerError } = await supabase
        .from("active_partners")
        .select("*, locations(*)")
        .ilike("email", session.user.email || "")
        .maybeSingle();
        
      if (partnerError) console.error("Database Error:", partnerError.message);

      if (!partnerData) {
        setSyncError("DATABASE DESYNC: You logged in successfully, but your partner profile is missing from the active_partners table. Please delete this test account and re-approve it in the Admin Panel to generate a fresh profile.");
        setLoading(false);
        return;
      }
      
      if (partnerData.tc_accepted === false) return router.push("/partner/terms");

      setPartner(partnerData);
      
      // 1b. Check if Compliance Documents are already uploaded
      const { data: fileList } = await supabase.storage.from('application_documents').list('', { search: `COMPLIANCE_${partnerData.id}` });
      if (fileList && fileList.length > 0) {
        setHasUploadedDocs(true);
      }
      
      // 2. Fetch Treasury Channels
      const { data: banks } = await supabase.from("company_bank_accounts").select("*").eq("is_active", true);
      if (banks) setCompanyBanks(banks);

      if (partnerData.center_id) {
        const [virtualsRes, upisRes] = await Promise.all([
          supabase.from("virtual_accounts").select("*, master_banks(*)").eq("assigned_location_id", partnerData.center_id).order("created_at", { ascending: false }),
          supabase.from("upi_ids").select("*, master_banks(*)").eq("assigned_location_id", partnerData.center_id).order("created_at", { ascending: false })
        ]);
        setVirtualAccounts(virtualsRes.data || []);
        setUpiIds(upisRes.data || []);
      }

      // 3. Fetch OCSC Agent Mappings
      const { data: ctopData } = await supabase
        .from("agent_ctop_mappings")
        .select("agent_ctop_no, agent_ocsc_login_id, is_active, master_ctop_accounts(master_ctop_no)")
        .eq("partner_id", partnerData.id)
        .eq("is_active", true);
        
      setPartnerCtops(ctopData || []);

      // 4. Fetch Alerts / Inbox
      const { data: msgData } = await supabase
        .from("partner_messages")
        .select("*")
        .eq("partner_id", partnerData.id)
        .order("created_at", { ascending: false });

      const fetchedMessages = msgData || [];
      setMessages(fetchedMessages);
      setUnreadCount(fetchedMessages.filter(m => !m.is_read).length);

      // 5. Fetch Ledger History
      await fetchAllLedgerData(partnerData.id);

    } catch (err: any) { 
      console.error("Init Error:", err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const fetchAllLedgerData = async (partnerId: string) => {
    try {
      const [salesRes, depositsRes] = await Promise.all([
        supabase.from("daily_sales_reports").select("*").eq("partner_id", partnerId).order('report_date', { ascending: false }),
        supabase.from("partner_deposits").select("*").eq("partner_id", partnerId).order('created_at', { ascending: false })
      ]);

      const safeSales = salesRes.data || [];
      const safeDeposits = depositsRes.data || [];

      setRawSales(safeSales);
      setRawDeposits(safeDeposits);

      const todayStr = getLocalDateString(new Date());
      setHasSubmittedToday(safeSales.some(s => normalizeToYYYYMMDD(s.report_date) === todayStr));

      // Calculate Lifetime Pending Balance
      let lifetimeCash = 0;
      safeSales.forEach(s => {
        lifetimeCash += (Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0) + Number(s.ctop_recharge_amt || 0) + Number(s.sim_replacement_amt || 0) + Number(s.sim_fancy_amt || 0) + Number(s.sim_postpaid_amt || 0) + Number(s.other_amt || 0));
      });
      
      let lifetimeDep = 0;
      safeDeposits.filter(d => d.status !== 'Discrepancy').forEach(d => {
        lifetimeDep += Number(d.deposit_amount || 0);
      });

      setLifetimePendingBalance(lifetimeCash - lifetimeDep);
      
      // Initialize view
      applyTimeFilter("monthly", safeSales, safeDeposits);

    } catch (error) { 
      console.error(error); 
    }
  };

  const applyTimeFilter = (mode: string, sales = rawSales, deposits = rawDeposits) => {
    let startDate = new Date();
    
    if (mode === "today") {
      // Keep today
    } else if (mode === "weekly") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (mode === "monthly") {
      startDate.setDate(1); 
    } else if (mode === "all") {
      startDate = new Date("2000-01-01");
    }
    
    const startStr = getLocalDateString(startDate);
    
    const filteredSales = sales.filter(s => normalizeToYYYYMMDD(s.report_date) >= startStr);
    const filteredDeposits = deposits.filter(d => normalizeToYYYYMMDD(d.created_at) >= startStr);

    let cbp = 0, ctop = 0, simCash = 0, postpaidCash = 0, otherCash = 0, cheque = 0, totalSales = 0, totalDep = 0;
    let qN = 0, qU = 0, qR = 0, qF = 0, qP = 0;

    filteredSales.forEach(s => {
      const sCbp = Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0);
      const sCtop = Number(s.ctop_recharge_amt || 0);
      const sSim = Number(s.sim_replacement_amt || 0) + Number(s.sim_fancy_amt || 0); 
      const sPost = Number(s.sim_postpaid_amt || 0); 
      const sOther = Number(s.other_amt || 0); 
      
      cbp += sCbp;
      ctop += sCtop;
      simCash += sSim;
      postpaidCash += sPost;
      otherCash += sOther;
      cheque += Number(s.cheque_amt || 0);
      totalSales += (sCbp + sCtop + sSim + sPost + sOther);

      qN += Number(s.sim_new_qty || 0);
      qU += Number(s.sim_upgrade_qty || 0);
      qR += Number(s.sim_replacement_qty || 0);
      qF += Number(s.sim_fancy_qty || 0);
      qP += Number(s.sim_postpaid_qty || 0);
    });

    filteredDeposits.filter(d => d.status !== 'Discrepancy').forEach(d => {
      totalDep += Number(d.deposit_amount || 0);
    });

    setDisplayLedger({
      totalCBP: cbp, totalCTOP: ctop, totalSimCash: simCash, totalPostpaidCash: postpaidCash, 
      totalOtherCash: otherCash, totalCheque: cheque, 
      totalCashSales: totalSales, totalDeposits: totalDep,
      qNew: qN, qUp: qU, qRep: qR, qFan: qF, qPost: qP
    });
    setTimeFilter(mode);
  };

  // --- READ RECEIPT ENGINE (Alerts) ---
  const handleReadMessage = async (msg: any) => {
    if (expandedMsgId === msg.id) {
      setExpandedMsgId(null);
      return;
    }
    setExpandedMsgId(msg.id);

    if (msg.is_read) return;

    try {
      setMessages(current => current.map(m => m.id === msg.id ? { ...m, is_read: true } : m));
      setUnreadCount(prev => Math.max(0, prev - 1));
      await supabase.from("partner_messages").update({ is_read: true }).eq("id", msg.id);
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  // --- EDIT REQUEST ENGINE ---
  const handleRequestEdit = async (saleId: string) => {
    if (editReason.trim().length < 5) {
      return alert("Please provide a detailed reason (minimum 5 characters) for requesting this edit.");
    }

    try {
      const { error } = await supabase.from('daily_sales_reports').update({
        edit_request_status: 'Pending',
        edit_request_reason: editReason
      }).eq('id', saleId);

      if (error) throw error;
      
      alert("✅ Edit request submitted. Waiting for Back-Office approval.");
      
      setRawSales(rawSales.map(s => s.id === saleId ? {...s, edit_request_status: 'Pending', edit_request_reason: editReason} : s));
      setRequestingEditId(null);
      setEditReason("");
    } catch (err: any) {
      alert("Error submitting request: " + err.message);
    }
  };

  // --- SECURE COMPLIANCE DOCUMENT UPLOAD ENGINE ---
  const handleDocFileChange = (e: React.ChangeEvent<HTMLInputElement>, docName: string) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) { 
        alert(`File size for ${docName} must be under 5MB.`);
        e.target.value = ''; 
        return;
      }
      setDocFiles(prev => ({ ...prev, [docName]: file }));
    }
  };

  const handleDocUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const requiredDocs = getRequiredDocuments(partner?.role);
    
    // Strict Validation
    for (const doc of requiredDocs) {
      if (!docFiles[doc]) {
        return alert(`Please upload the mandatory document: ${doc}`);
      }
    }

    setIsUploadingDocs(true);
    setDocUploadMessage("Fetching network details...");

    try {
      let userIp = "Unknown";
      try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        userIp = (await ipRes.json()).ip;
      } catch (err) { }

      setDocUploadMessage("Merging documents into a secure PDF...");

      const pdfDoc = await PDFDocument.create();
      const trackingFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const timestamp = new Date().toLocaleString('en-IN');
      const stampText = `USER: ${partner.email} | LOC: ${partner.locations?.center_name || 'N/A'} | IP: ${userIp} | TIME: ${timestamp}`;

      for (const docName of requiredDocs) {
        const file = docFiles[docName];
        if (!file) continue;

        const arrayBuffer = await file.arrayBuffer();
        const mimeType = file.type.toLowerCase();

        setDocUploadMessage(`Processing ${docName}...`);

        if (mimeType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
          const loadedPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          const copiedPages = await pdfDoc.copyPages(loadedPdf, loadedPdf.getPageIndices());
          
          copiedPages.forEach((page) => {
            pdfDoc.addPage(page);
            const { width } = page.getSize();
            page.drawRectangle({ x: 0, y: 0, width: width, height: 20, color: rgb(0, 0, 0) });
            page.drawText(`${docName.toUpperCase()} | ${stampText}`, { x: 10, y: 6, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
          });
        } else if (mimeType.includes('jpeg') || mimeType.includes('jpg') || mimeType.includes('png') || file.name.toLowerCase().endsWith('.png') || file.name.toLowerCase().endsWith('.jpg')) {
          let image = (mimeType.includes('png') || file.name.toLowerCase().endsWith('.png'))
            ? await pdfDoc.embedPng(arrayBuffer) 
            : await pdfDoc.embedJpg(arrayBuffer);
          
          let { width, height } = image;
          const maxWidth = 595.28; 
          if (width > maxWidth) {
            const ratio = maxWidth / width;
            width = maxWidth;
            height = height * ratio;
          }

          const page = pdfDoc.addPage([width, height + 25]);
          page.drawImage(image, { x: 0, y: 25, width: width, height: height });
          page.drawRectangle({ x: 0, y: 0, width: width, height: 25, color: rgb(0, 0, 0) });
          page.drawText(`${docName.toUpperCase()} | ${stampText}`, { x: 10, y: 8, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
        }
      }

      setDocUploadMessage("Uploading secure Compliance PDF to Vault...");
      const mergedPdfBytes = await pdfDoc.save();
      const pdfFileName = `COMPLIANCE_${partner.id}_${Date.now()}.pdf`;

      const { error: uploadError, data } = await supabase.storage
        .from('application_documents')
        .upload(pdfFileName, mergedPdfBytes, { contentType: 'application/pdf' });

      if (uploadError) throw uploadError;

      // Update active_partners to store the link so Admin Dashboard can easily reference it
      await supabase.from('active_partners').update({ compliance_docs_url: data.path }).eq('id', partner.id);

      setHasUploadedDocs(true);
      setDocUploadMessage("✅ Documents successfully locked and stored.");
      setTimeout(() => setDocUploadMessage(""), 5000);

    } catch (error: any) {
      console.error(error);
      alert("Upload Failed: " + error.message);
      setDocUploadMessage("");
    } finally {
      setIsUploadingDocs(false);
    }
  };

  // --- CSV EXPORT ENGINE ---
  const sanitize = (str: any) => `"${String(str || '').replace(/"/g, '""')}"`;

  const downloadCSV = () => {
    const startStr = timeFilter === "all" ? "2000-01-01" : 
                     timeFilter === "monthly" ? getLocalDateString(new Date(new Date().setDate(1))) :
                     timeFilter === "weekly" ? getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 7))) : 
                     getLocalDateString(new Date());

    const exportData = rawSales.filter(s => normalizeToYYYYMMDD(s.report_date) >= startStr);
    if (exportData.length === 0) return alert("No data to export for this time period.");

    const headers = [
      "Report Date", "CBP Landline", "CBP GSM", "CTOP Amount", 
      "SIM New Qty", "SIM Upgrade Qty", "SIM Replace Qty", "SIM Replace Amt",
      "Fancy Qty", "Fancy Amt", "Postpaid Qty", "Postpaid Amt", "Cheque Amount", "Other Amount", "Audited Status"
    ];

    const csvContent = [
      headers.join(","),
      ...exportData.map(s => [
        sanitize(formatToDDMMYYYY(s.report_date)),
        s.cbp_landline_amt || 0, s.cbp_gsm_amt || 0, s.ctop_recharge_amt || 0,
        s.sim_new_qty || 0, s.sim_upgrade_qty || 0, s.sim_replacement_qty || 0, s.sim_replacement_amt || 0,
        s.sim_fancy_qty || 0, s.sim_fancy_amt || 0, s.sim_postpaid_qty || 0, s.sim_postpaid_amt || 0,
        s.cheque_amt || 0, s.other_amt || 0, sanitize(s.is_edited_by_staff ? "Audited" : "Original")
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Sales_${timeFilter}_${formatToDDMMYYYY(getLocalDateString(new Date())).replace(/\//g, '-')}.csv`;
    link.click();
  };

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const handleSignOut = async () => { 
    setIsLoggingOut(true);
    await supabase.auth.signOut(); 
    router.push("/partner/login"); 
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
    </div>
  );

  if (syncError) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="bg-red-50 p-8 rounded-2xl shadow-sm border-2 border-red-200 max-w-lg w-full text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-black text-red-800 mb-3 uppercase tracking-widest">Database Sync Error</h2>
        <p className="text-sm font-bold text-red-900 mb-6 leading-relaxed">{syncError}</p>
        <button onClick={handleSignOut} className="bg-red-600 hover:bg-red-700 text-white font-black px-6 py-3 rounded-lg shadow transition w-full">
          Sign Out & Reset Session
        </button>
      </div>
    </div>
  );

  const totalPrepaid = displayLedger.qNew + displayLedger.qUp + displayLedger.qRep + displayLedger.qFan;
  const startStr = timeFilter === "all" ? "2000-01-01" : 
                   timeFilter === "monthly" ? getLocalDateString(new Date(new Date().setDate(1))) :
                   timeFilter === "weekly" ? getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 7))) : 
                   getLocalDateString(new Date());

  const visibleSales = rawSales.filter(s => normalizeToYYYYMMDD(s.report_date) >= startStr);
  const visibleDeposits = rawDeposits.filter(d => normalizeToYYYYMMDD(d.created_at) >= startStr);
  const requiredDocs = getRequiredDocuments(partner?.role);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      
      {/* TOP NAVIGATION */}
      <nav className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shadow-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black text-xl">F</div>
          <div>
            <h1 className="font-black text-lg leading-tight tracking-wide">FAST ARK</h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Partner Operations Hub</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden md:flex bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg text-right shadow-sm items-center gap-2 cursor-pointer hover:bg-slate-700 transition" title="View Inbox Below">
            <span className="text-xl animate-pulse">{unreadCount > 0 ? '🔔' : '🔕'}</span>
            <div>
              <p className="text-[9px] text-purple-400 font-black uppercase tracking-widest leading-none">Unread Alerts</p>
              <p className={`font-black text-xs ${unreadCount > 0 ? 'text-red-400' : 'text-slate-400'}`}>{unreadCount} Notices</p>
            </div>
          </div>
          <button onClick={handleSignOut} disabled={isLoggingOut} className="text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded transition">
            {isLoggingOut ? "Closing Session..." : "Secure Logout"}
          </button>
        </div>
      </nav>

      <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-8">
        
        {/* PRIORITY ALERTS (Force Read Display) */}
        {messages.filter(m => !m.is_read).length > 0 && (
          <div className="bg-red-50 border-l-4 border-red-600 p-5 rounded-r-xl shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
            <h3 className="font-black text-red-800 flex items-center gap-2 text-lg">
              <span className="text-2xl">⚠️</span> Unread Corporate Notices
            </h3>
            <p className="text-xs font-bold text-red-700 mb-3">You must acknowledge these notices in your Official Inbox (bottom of page).</p>
          </div>
        )}

        {/* HEADER & WELCOME */}
        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h2 className="text-3xl font-black text-slate-900">Welcome, {partner?.partner_name}</h2>
            <p className="text-slate-500 font-medium mt-1">Manage your treasury channels, stock, and operational ledgers.</p>
          </div>
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest shadow-sm">
            {partner?.role || "Active Partner"}
          </span>
        </div>

        {/* DEPOSIT ESCALATION BANNER */}
        {lifetimePendingBalance >= 1000 && (
          <div className="bg-red-600 text-white p-4 rounded-xl shadow-lg border-2 border-red-800 flex flex-col md:flex-row items-start md:items-center justify-between animate-pulse">
            <div>
              <h3 className="font-black text-lg uppercase tracking-widest flex items-center gap-2">
                <span className="text-2xl">🚨</span> Priority Remittance Required
              </h3>
              <p className="font-bold text-sm mt-1">
                Your pending cash balance has exceeded the ₹1,000 limit. Settle your ledger immediately to avoid account suspension.
              </p>
            </div>
            <div className="mt-4 md:mt-0 text-left md:text-right">
              <p className="text-xs uppercase font-black text-red-200">Pending Amount</p>
              <p className="text-3xl font-black">₹{lifetimePendingBalance.toLocaleString('en-IN')}</p>
            </div>
          </div>
        )}

        {/* SECTION: INFRASTRUCTURE & TREASURY CHANNELS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Card 1: Read-Only User Profile */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
            <div className="bg-slate-100 px-5 py-3 border-b border-slate-200">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Partner Profile</h3>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Full Name</p>
                  <p className="font-black text-slate-800">{partner?.partner_name}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Email ID</p>
                  <p className="font-bold text-slate-800 text-sm break-all">{partner?.email}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Mobile No</p>
                  <p className="font-bold text-slate-800 text-sm">{partner?.mobile || partner?.phone || "N/A"}</p>
                </div>
              </div>
              <p className="text-[9px] text-red-500 font-bold uppercase mt-4 bg-red-50 p-2 border border-red-100 rounded">
                * Edits are strictly restricted. Contact Admin for profile updates.
              </p>
            </div>
          </div>

          {/* Card 2: Assigned Location */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden border-t-4 border-t-blue-600 h-full flex flex-col">
            <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Assigned Center</h3>
              <span className="text-[9px] font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded border border-blue-200">
                {partner?.locations?.center_code || "NO-CODE"}
              </span>
            </div>
            <div className="p-5 flex-1 space-y-4">
              <div>
                <h4 className="font-black text-lg text-slate-900">{partner?.locations?.center_name || "Unassigned"}</h4>
                <p className="text-xs font-bold text-slate-500 mt-1 uppercase">BA: {partner?.locations?.ba || "N/A"} | OA: {partner?.locations?.oa || "N/A"}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Geographic Zone</p>
                <p className="text-sm font-bold text-slate-700 leading-relaxed">
                  {partner?.locations?.taluk ? `${partner?.locations.taluk}, ` : ""}
                  {partner?.locations?.dist}<br/>
                  {partner?.locations?.state} - {partner?.locations?.pin_code}
                </p>
              </div>
            </div>
          </div>

          {/* Card 3: Telecom & OCSC Channels */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col border-t-4 border-t-emerald-500">
            <div className="bg-emerald-50 px-5 py-3 border-b border-emerald-100 flex justify-between items-center">
              <h3 className="text-xs font-black text-emerald-900 uppercase tracking-widest">Telecom & OCSC</h3>
              <span className="text-lg opacity-50">📡</span>
            </div>
            <div className="p-4 flex-1 overflow-y-auto max-h-60">
              {partnerCtops.length === 0 ? (
                <p className="text-xs font-bold text-slate-400 text-center py-4">No CTOP credentials mapped to this account.</p>
              ) : (
                <div className="space-y-3">
                  {partnerCtops.map((ctop, idx) => (
                    <div key={idx} className="p-3 rounded-lg border-2 border-emerald-200 bg-emerald-50/50 shadow-sm relative overflow-hidden">
                      <div className="absolute right-0 top-0 text-3xl opacity-10">🔐</div>
                      <p className="text-[9px] font-black text-emerald-800 uppercase tracking-widest mb-2 flex justify-between">
                        <span>Master: {ctop.master_ctop_accounts?.master_ctop_no}</span>
                      </p>
                      <div className="mb-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Partner CTOP No</p>
                        <p className="font-black text-lg text-slate-900 tracking-wider">{ctop.agent_ctop_no}</p>
                      </div>
                      {ctop.agent_ocsc_login_id && (
                        <div className="pt-2 border-t border-emerald-100">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">OCSC Login ID</p>
                          <p className="font-bold text-slate-800 break-all">{ctop.agent_ocsc_login_id}</p>
                        </div>
                      )}
                      {!ctop.is_active && (
                        <div className="mt-2 bg-red-500/20 border border-red-500/50 p-1.5 rounded text-center">
                          <p className="text-[9px] font-black text-red-700 uppercase tracking-widest">⚠️ Suspended</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Card 4: Virtual Accounts */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
            <div className="bg-amber-50 px-5 py-3 border-b border-amber-100 flex justify-between items-center">
              <h3 className="text-xs font-black text-amber-900 uppercase tracking-widest">Virtual Accts (CMS)</h3>
              <span className="text-lg opacity-50">🏦</span>
            </div>
            <div className="p-4 flex-1 overflow-y-auto max-h-60">
              {virtualAccounts.length === 0 ? (
                <p className="text-xs font-bold text-slate-400 text-center py-4">No virtual accounts assigned.</p>
              ) : (
                <div className="space-y-3">
                  {virtualAccounts.map((va, idx) => (
                    <div key={idx} className={`p-3 rounded border ${va.is_active ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50 opacity-70 grayscale'}`}>
                      <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1.5">{va.master_banks?.bank_name}</p>
                      <p className="font-black text-lg text-slate-900 tracking-wider">{va.virtual_account_no}</p>
                      <p className="text-xs font-bold text-slate-500 mt-0.5">IFSC: {va.virtual_ifsc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Card 5: UPI Channels */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
            <div className="bg-purple-50 px-5 py-3 border-b border-purple-100 flex justify-between items-center">
              <h3 className="text-xs font-black text-purple-900 uppercase tracking-widest">Digital UPI Channels</h3>
              <span className="text-lg opacity-50">📱</span>
            </div>
            <div className="p-4 flex-1 overflow-y-auto max-h-60">
              {upiIds.length === 0 ? (
                <p className="text-xs font-bold text-slate-400 text-center py-4">No UPI channels assigned.</p>
              ) : (
                <div className="space-y-3">
                  {upiIds.map((upi, idx) => (
                    <div key={idx} className={`p-3 rounded border flex flex-col justify-center ${upi.is_active ? 'border-purple-200 bg-purple-50/50' : 'border-slate-200 bg-slate-50 opacity-70 grayscale'}`}>
                      <p className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-1">{upi.master_banks?.bank_name}</p>
                      <p className="font-black text-md text-slate-900 break-all">{upi.upi_id}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Card 6: Store Marketing Assets & QR */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col border-t-4 border-t-pink-500">
            <div className="bg-pink-50 px-5 py-3 border-b border-pink-100 flex justify-between items-center">
              <h3 className="text-xs font-black text-pink-900 uppercase tracking-widest">Store Assets & QR</h3>
              <span className="text-lg opacity-50">🖨️</span>
            </div>
            <div className="p-4 flex-1 flex flex-col justify-center items-center text-center">
              {partner?.locations?.qr_asset_url ? (
                <>
                  <div className="text-4xl mb-3">🖼️</div>
                  <h4 className="font-black text-slate-800 text-sm mb-1">Official Store QR Code</h4>
                  <p className="text-[10px] text-slate-500 font-bold mb-4">Mapped specifically to {partner?.locations?.center_name}</p>
                  <a 
                    href={partner.locations.qr_asset_url} 
                    target="_blank" 
                    rel="noreferrer"
                    download={`FastArk_QR_${partner?.locations?.center_code || 'Asset'}.png`}
                    className="w-full bg-pink-600 hover:bg-pink-700 text-white font-black py-2.5 rounded-lg shadow-sm text-xs uppercase tracking-widest transition block"
                  >
                    Download Print Asset
                  </a>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full opacity-60">
                  <div className="text-4xl mb-2">🚫</div>
                  <p className="text-xs font-bold text-slate-500">No Custom QR Mapped</p>
                  <p className="text-[9px] text-slate-400 mt-1 uppercase tracking-widest">Please Contact Admin</p>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* SECTION: COMPLIANCE DOCUMENTS UPLOAD ENGINE */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
          <div className="p-5 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
            <div>
              <h2 className="font-black text-lg tracking-wide flex items-center gap-2"><span>📂</span> Mandatory Compliance Documents</h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Upload required operational documents for your role ({partner?.role})</p>
            </div>
            {hasUploadedDocs && (
              <span className="bg-green-100 text-green-800 border border-green-200 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded">✅ Uploaded & Locked</span>
            )}
          </div>
          
          <div className="p-6">
             {hasUploadedDocs ? (
                <div className="text-center p-8 bg-green-50 border border-green-200 rounded-xl">
                   <span className="text-4xl mb-3 block">🔒</span>
                   <h3 className="font-black text-green-800 text-lg">Documents Successfully Submitted</h3>
                   <p className="text-sm font-bold text-green-700 mt-2">Your compliance documents have been securely merged, watermarked, and locked. They are now visible to the Corporate Command Center.</p>
                </div>
             ) : (
                <form onSubmit={handleDocUploadSubmit} className="space-y-6">
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {requiredDocs.map((docName, idx) => (
                         <div key={idx} className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex flex-col justify-between">
                            <label className="block text-xs font-black text-slate-700 uppercase tracking-widest mb-2">{idx + 1}. {docName} *</label>
                            <input 
                               type="file" 
                               accept=".pdf, .jpg, .jpeg, .png" 
                               required 
                               onChange={(e) => handleDocFileChange(e, docName)}
                               className="w-full text-xs font-medium text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                            />
                         </div>
                      ))}
                   </div>
                   {docUploadMessage && (
                      <div className="p-3 bg-blue-50 text-blue-800 text-sm font-bold rounded border border-blue-200 text-center animate-pulse">
                         {docUploadMessage}
                      </div>
                   )}
                   <button 
                      type="submit" 
                      disabled={isUploadingDocs}
                      className="w-full py-4 bg-slate-900 text-white font-black rounded-xl shadow-md uppercase tracking-widest hover:bg-blue-600 transition disabled:opacity-50"
                   >
                      {isUploadingDocs ? "Processing & Watermarking Securely..." : "Submit & Permanently Lock Documents"}
                   </button>
                </form>
             )}
          </div>
        </div>

        {/* SECTION: LIVE FINANCIAL LEDGER */}
        <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden mt-8">
          
          <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-white font-black text-lg tracking-wide">Operational Ledger</h2>
              <span className="text-xs font-bold bg-blue-900/50 text-blue-300 px-3 py-1 rounded-full border border-blue-800 mt-2 inline-block">
                Monitoring Status: ACTIVE
              </span>
            </div>
            
            <div className="flex bg-slate-800 rounded-lg p-1">
              {['today', 'weekly', 'monthly', 'all'].map(mode => (
                <button 
                  key={mode} 
                  onClick={() => applyTimeFilter(mode)} 
                  className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition ${timeFilter === mode ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-slate-800">
            <div className="col-span-1 md:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-px bg-slate-800">
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">CBP Sales</p><p className="text-2xl font-black text-white">₹{displayLedger.totalCBP.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">CTOP Sales</p><p className="text-2xl font-black text-white">₹{displayLedger.totalCTOP.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">SIM Cash (Prepaid)</p><p className="text-2xl font-black text-white">₹{displayLedger.totalSimCash.toLocaleString('en-IN')}</p></div>
              
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Postpaid Cash</p><p className="text-xl font-black text-purple-400">₹{displayLedger.totalPostpaidCash.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Other Cash</p><p className="text-xl font-black text-emerald-400">₹{displayLedger.totalOtherCash.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-amber-500/70 font-bold uppercase tracking-widest mb-1">Cheques</p><p className="text-xl font-black text-amber-500">₹{displayLedger.totalCheque.toLocaleString('en-IN')}</p></div>
            </div>
            
            <div className="col-span-1 bg-slate-900 p-6 flex flex-col justify-center border-l-0 md:border-l-4 border-t-4 md:border-t-0 border-blue-600">
              <div className="mb-5"><p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-1">Generated</p><p className="text-2xl md:text-3xl font-black text-white">₹{displayLedger.totalCashSales.toLocaleString('en-IN')}</p></div>
              <div><p className="text-[10px] text-green-400 font-black uppercase tracking-widest mb-1">Remitted</p><p className="text-2xl md:text-3xl font-black text-white">₹{displayLedger.totalDeposits.toLocaleString('en-IN')}</p></div>
            </div>
          </div>
          
          <div className="bg-slate-800 p-4 border-t border-b border-slate-700 flex justify-between items-center">
            <h3 className="font-black text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2"><span>📱</span> SIM Activations ({timeFilter})</h3>
            <div className="flex gap-4">
              <span className="bg-blue-900/50 text-blue-300 font-black px-3 py-1 rounded text-xs border border-blue-800">Prepaid: {totalPrepaid}</span>
              <span className="bg-purple-900/50 text-purple-300 font-black px-3 py-1 rounded text-xs border border-purple-800">Postpaid: {displayLedger.qPost}</span>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-px bg-slate-700">
            <div className="bg-slate-900 p-3 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">New</p><p className="text-lg font-black text-white">{displayLedger.qNew}</p></div>
            <div className="bg-slate-900 p-3 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Upgrade</p><p className="text-lg font-black text-white">{displayLedger.qUp}</p></div>
            <div className="bg-slate-900 p-3 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Replace</p><p className="text-lg font-black text-white">{displayLedger.qRep}</p></div>
            <div className="bg-slate-900 p-3 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Fancy</p><p className="text-lg font-black text-white">{displayLedger.qFan}</p></div>
            <div className="bg-slate-900 p-3 text-center"><p className="text-[10px] text-purple-400 font-bold uppercase mb-1">Post</p><p className="text-lg font-black text-white">{displayLedger.qPost}</p></div>
          </div>

          <div className={`p-5 text-center ${lifetimePendingBalance > 0 ? 'bg-amber-100 text-amber-900 border-t border-amber-200' : 'bg-green-100 text-green-900 border-t border-green-200'}`}>
            <span className="font-black text-sm uppercase tracking-widest mr-2">{lifetimePendingBalance > 0 ? '⚠️ Total Pending Cash to Deposit:' : '✅ Ledger Settled:'}</span>
            <span className="text-2xl font-black">₹{Math.max(0, lifetimePendingBalance).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
            <p className="text-[10px] font-bold opacity-70 mt-1 uppercase">*Pending balance is calculated across lifetime operations.</p>
          </div>
        </div>

        {/* QUICK ACTIONS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <Link href="/partner/stock" className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all hover:border-blue-400 hover:-translate-y-1 group block">
            <div className="text-3xl mb-3">📦</div>
            <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">Stock Requisitions</h3>
            <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Request CBP, CTOP balance, or physical SIM cards.</p>
          </Link>
          
          {hasSubmittedToday ? (
            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 opacity-70 cursor-not-allowed select-none transition-all border-dashed border-2">
              <div className="text-3xl mb-3">✅</div>
              <h3 className="font-black text-lg text-slate-600">Sales Logged</h3>
              <p className="text-green-600 font-bold text-xs mt-1.5 leading-relaxed">Your report for today ({formatToDDMMYYYY(getLocalDateString(new Date()))}) has already been securely submitted.</p>
            </div>
          ) : (
            <Link href="/partner/sales" className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all hover:border-blue-400 hover:-translate-y-1 group block">
              <div className="text-3xl mb-3">📊</div>
              <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">Daily Sales Entry</h3>
              <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Submit your mandatory end-of-day sales report.</p>
            </Link>
          )}

          <Link href="/partner/deposit" className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all hover:border-blue-400 hover:-translate-y-1 group block">
            <div className="text-3xl mb-3">💳</div>
            <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">Deposit of Sales</h3>
            <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Settle your pending balance and upload bank slips.</p>
          </Link>
        </div>

        {/* BOTTOM GRID: HISTORICAL LOGS & CORPORATE INBOX */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          
          {/* Sales History */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
              <h2 className="font-black text-slate-800">Sales Reports ({timeFilter})</h2>
              <button onClick={downloadCSV} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded font-black uppercase tracking-widest hover:bg-indigo-100 transition shadow-sm">
                📥 Export CSV
              </button>
            </div>
            <div className="p-0">
              {visibleSales.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No sales submitted in this period.</p> : (
                <ul className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                  {visibleSales.map(sale => {
                    const totalCash = Number(sale.cbp_landline_amt || 0) + Number(sale.cbp_gsm_amt || 0) + Number(sale.ctop_recharge_amt || 0) + Number(sale.sim_replacement_amt || 0) + Number(sale.sim_fancy_amt || 0) + Number(sale.sim_postpaid_amt || 0) + Number(sale.other_amt || 0);
                    const totalSims = Number(sale.sim_new_qty || 0) + Number(sale.sim_upgrade_qty || 0) + Number(sale.sim_replacement_qty || 0) + Number(sale.sim_fancy_qty || 0) + Number(sale.sim_postpaid_qty || 0);
                    const isExpanded = expandedSaleId === sale.id;

                    return (
                      <li key={sale.id} className="transition">
                        <div className="p-4 hover:bg-slate-50 flex justify-between items-center cursor-pointer" onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}>
                          <div>
                            <p className="font-bold text-slate-900">{formatToDDMMYYYY(sale.report_date)}</p>
                            <div className="flex gap-2 mt-1">
                              {sale.is_edited_by_staff ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-black uppercase rounded shadow-sm border border-amber-200">Audited</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black uppercase rounded shadow-sm border border-green-200">Original</span>
                              )}
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase rounded shadow-sm border border-blue-200">{totalSims} SIMs</span>
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end">
                            <p className="font-black text-slate-800">₹{totalCash.toLocaleString('en-IN')}</p>
                            <span className="text-[10px] text-blue-600 font-bold uppercase mt-1 flex items-center hover:underline">
                              {isExpanded ? 'Hide Details ▲' : 'View Details ▼'}
                            </span>
                          </div>
                        </div>
                        
                        {isExpanded && (
                          <div className="bg-slate-800 p-4 border-t border-slate-700 animate-in fade-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-y-4 gap-x-2">
                              <div><p className="text-[10px] font-black text-slate-400 uppercase">CBP Landline</p><p className="text-sm font-bold text-white">₹{sale.cbp_landline_amt || 0}</p></div>
                              <div><p className="text-[10px] font-black text-slate-400 uppercase">CBP GSM</p><p className="text-sm font-bold text-white">₹{sale.cbp_gsm_amt || 0}</p></div>
                              <div><p className="text-[10px] font-black text-slate-400 uppercase">CTOP</p><p className="text-sm font-bold text-white">₹{sale.ctop_recharge_amt || 0}</p></div>
                              <div><p className="text-[10px] font-black text-emerald-400 uppercase">Other Cash</p><p className="text-sm font-bold text-emerald-400">₹{sale.other_amt || 0}</p></div>
                              <div><p className="text-[10px] font-black text-amber-500 uppercase">Cheque</p><p className="text-sm font-bold text-amber-500">₹{sale.cheque_amt || 0}</p></div>
                              
                              <div><p className="text-[10px] font-black text-slate-400 uppercase">New SIMs</p><p className="text-sm font-bold text-white">{sale.sim_new_qty || 0}</p></div>
                              <div><p className="text-[10px] font-black text-slate-400 uppercase">Upgrades</p><p className="text-sm font-bold text-white">{sale.sim_upgrade_qty || 0}</p></div>
                              <div><p className="text-[10px] font-black text-slate-400 uppercase">Replacements</p><p className="text-sm font-bold text-white">{sale.sim_replacement_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_replacement_amt || 0})</span></p></div>
                              <div><p className="text-[10px] font-black text-slate-400 uppercase">Fancy SIMs</p><p className="text-sm font-bold text-white">{sale.sim_fancy_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_fancy_amt || 0})</span></p></div>
                              <div><p className="text-[10px] font-black text-purple-400 uppercase">Postpaid</p><p className="text-sm font-bold text-white">{sale.sim_postpaid_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_postpaid_amt || 0})</span></p></div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-700">
                              {sale.edit_request_status === 'Pending' ? (
                                <div className="bg-amber-900/30 border border-amber-800 p-3 rounded-lg flex items-center justify-between">
                                  <span className="text-amber-500 font-bold text-xs uppercase">⏳ Edit Request Pending</span>
                                  <span className="text-slate-400 text-[10px] truncate max-w-[150px]">Reason: {sale.edit_request_reason}</span>
                                </div>
                              ) : sale.edit_request_status === 'Approved' ? (
                                <div className="bg-green-900/30 border border-green-800 p-3 rounded-lg flex items-center justify-between">
                                  <span className="text-green-500 font-bold text-xs uppercase">✅ Edit Request Approved</span>
                                  <Link href={`/partner/sales`} className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded font-black text-xs transition">Edit Sales Now</Link>
                                </div>
                              ) : sale.edit_request_status === 'Rejected' ? (
                                <div className="bg-red-900/30 border border-red-800 p-3 rounded-lg flex flex-col">
                                  <span className="text-red-500 font-bold text-xs uppercase mb-1">❌ Edit Request Rejected</span>
                                  <span className="text-slate-400 text-[10px]">Your request to edit was declined by the back-office.</span>
                                </div>
                              ) : (
                                requestingEditId === sale.id ? (
                                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-700">
                                    <label className="text-[10px] text-amber-500 font-bold uppercase block mb-2">Reason for Edit Request *</label>
                                    <input 
                                      type="text" value={editReason} onChange={e => setEditReason(e.target.value)} 
                                      placeholder="e.g. Typo in CTOP cash amount..." 
                                      className="w-full bg-slate-800 text-white border border-slate-600 rounded p-2 text-xs outline-none mb-3 focus:border-amber-500"
                                    />
                                    <div className="flex gap-2">
                                      <button onClick={() => handleRequestEdit(sale.id)} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded text-xs transition shadow-sm">Submit Request</button>
                                      <button onClick={() => setRequestingEditId(null)} className="bg-slate-700 hover:bg-slate-600 text-white font-bold px-4 py-2 rounded text-xs transition shadow-sm">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => setRequestingEditId(sale.id)} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold px-4 py-2 rounded-lg text-xs transition border border-slate-600 flex justify-center items-center gap-2">
                                    <span>⚠️️</span> Request Permission to Edit this Report
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {/* Deposits History */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
              <div className="p-4 border-b bg-slate-50"><h2 className="font-black text-slate-800">Deposit of Sales ({timeFilter})</h2></div>
              <div className="p-0">
                {visibleDeposits.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No deposits submitted in this period.</p> : (
                  <ul className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                    {visibleDeposits.map(dep => (
                      <li key={dep.id} className="p-4 hover:bg-slate-50 flex justify-between items-center transition">
                        <div>
                          <p className="font-bold text-slate-900">{formatToDDMMYYYY(dep.created_at)}</p>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase mt-1 inline-block border ${dep.status === 'Verified' ? 'bg-green-100 text-green-700 border-green-200' : dep.status === 'Discrepancy' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                            {dep.status}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className={`font-black ${dep.status === 'Discrepancy' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>₹{Number(dep.deposit_amount).toLocaleString('en-IN')}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">{dep.deposit_method}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* CORPORATE INBOX (ALERTS) */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit flex flex-col max-h-[600px]">
              <div className="p-5 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white shrink-0">
                <div>
                  <h3 className="font-black tracking-widest uppercase text-sm flex items-center gap-2"><span>💬</span> Corporate Inbox</h3>
                  <p className="text-[10px] text-slate-400 font-bold mt-1">Official Notices & Audit Alerts</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black">{messages.length}</p>
                  <p className="text-[9px] text-purple-400 uppercase tracking-widest font-black">Total Records</p>
                </div>
              </div>
              
              <div className="overflow-y-auto flex-1 p-4 bg-slate-50">
                {messages.length === 0 ? (
                  <div className="text-center p-10">
                    <span className="text-5xl mb-4 block">📭</span>
                    <p className="text-slate-500 font-bold">Your inbox is clear.</p>
                    <p className="text-xs text-slate-400 mt-1">No corporate alerts have been issued.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map(msg => {
                      const isUnread = !msg.is_read;
                      const isExpanded = expandedMsgId === msg.id;
                      const isBroadcast = msg.subject.includes('BROADCAST');

                      return (
                        <div 
                          key={msg.id} 
                          onClick={() => handleReadMessage(msg)}
                          className={`border rounded-xl transition-all cursor-pointer overflow-hidden shadow-sm hover:shadow-md ${
                            isUnread ? 'bg-white border-purple-300' : 'bg-slate-100 border-slate-200 opacity-80 hover:opacity-100'
                          }`}
                        >
                          <div className="p-4 flex gap-4 items-start">
                            <div className="shrink-0 mt-1">
                              {isUnread ? (
                                <span className="relative flex h-4 w-4">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-4 w-4 bg-purple-600"></span>
                                </span>
                              ) : (
                                <span className="text-slate-400">✅</span>
                              )}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start mb-1">
                                <h4 className={`text-sm truncate pr-2 ${isUnread ? 'font-black text-slate-900' : 'font-bold text-slate-700'}`}>
                                  {msg.subject}
                                </h4>
                                <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap shrink-0 mt-0.5">
                                  {new Date(msg.created_at).toLocaleDateString('en-IN', {day:'numeric', month:'short'})}
                                </span>
                              </div>
                              
                              {!isExpanded && (
                                <p className="text-xs text-slate-500 truncate font-medium">
                                  {msg.body}
                                </p>
                              )}

                              {isBroadcast && !isExpanded && (
                                <span className="inline-block mt-2 text-[9px] font-black uppercase tracking-widest bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                  Global Broadcast
                                </span>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-white animate-in slide-in-from-top-2 duration-200">
                              <div className="flex justify-between items-center mb-3">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                  Received: {new Date(msg.created_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute:'2-digit'})}
                                </span>
                                {isBroadcast && (
                                  <span className="text-[9px] font-black uppercase tracking-widest bg-purple-100 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
                                    Global Broadcast
                                  </span>
                                )}
                              </div>
                              
                              <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed font-medium bg-slate-50 p-4 rounded-lg border border-slate-100">
                                {msg.body}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              
              <div className="bg-slate-100 p-3 border-t border-slate-200 flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-600"></span> Unread Alert</span>
                <span className="flex items-center gap-1">✅ Read & Logged</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}