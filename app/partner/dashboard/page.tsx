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
  const [virtualAccounts, setVirtualAccounts] = useState<any[]>([]);
  const [upiIds, setUpiIds] = useState<any[]>([]);

  // --- Mobile UI States ---
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);

  // --- Historical Ledger State ---
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);
  
  const [timeFilter, setTimeFilter] = useState("monthly");
  const [hasSubmittedToday, setHasSubmittedToday] = useState(false);
  const [lifetimePendingBalance, setLifetimePendingBalance] = useState(0);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  // --- FIX: Restored Edit Request State ---
  const [requestingEditId, setRequestingEditId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");

  const [displayLedger, setDisplayLedger] = useState({
    totalCBP: 0, totalCTOP: 0, totalSimCash: 0, totalPostpaidCash: 0, totalOtherCash: 0, 
    totalPaybullCash: 0, 
    totalCheque: 0, totalCashSales: 0, totalDeposits: 0,
    qNew: 0, qUp: 0, qRep: 0, qFan: 0, qPost: 0, qMnp: 0 
  });

  // --- Compliance Document Upload State ---
  const [docFiles, setDocFiles] = useState<Record<string, File | File[] | null>>({});
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [hasUploadedDocs, setHasUploadedDocs] = useState(false);
  const [docUploadMessage, setDocUploadMessage] = useState("");

  const getRequiredDocuments = (role: string) => {
    const r = (role || "").toUpperCase();
    if (r.includes("OCSC")) {
      return ["Marks Card", "Photo with Location GPS Tagged (5 Nos)", "HOTO Letter Copy", "Police Verification Certificate", "Bank Passbook / Cancel Cheque"];
    } else if (r.includes("AADHAAR")) {
      return ["Marks Card (12th Pass)", "Photo with Location GPS Tagged (5 Nos)", "HOTO Letter Copy", "Police Verification Certificate", "NSEIT Certificate", "LMS Certificate", "Annexure A & B", "L1 Readiness Document", "100 Rs BSNL Stamp Undertaking", "100 Rs Company Stamp Undertaking", "EA Request Form", "Bank Passbook / Cancel Cheque"];
    } else {
      return ["GST Certificate", "Bank Mapping", "Other Document 1", "Other Document 2", "Other Document 3"];
    }
  };

  useEffect(() => {
    initializeDashboard();
  }, [router]);

  const initializeDashboard = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

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
      
      // Verify Document Vault Status
      const { data: fileList } = await supabase.storage.from('application_documents').list('', { search: `COMPLIANCE_${partnerData.id}` });
      if (fileList && fileList.length > 0) {
        setHasUploadedDocs(true);
      }
      
      if (partnerData.center_id) {
        const [virtualsRes, upisRes] = await Promise.all([
          supabase.from("virtual_accounts").select("*, master_banks(*)").eq("assigned_location_id", partnerData.center_id).order("created_at", { ascending: false }),
          supabase.from("upi_ids").select("*, master_banks(*)").eq("assigned_location_id", partnerData.center_id).order("created_at", { ascending: false })
        ]);
        setVirtualAccounts(virtualsRes.data || []);
        setUpiIds(upisRes.data || []);
      }

      const { data: ctopData } = await supabase
        .from("agent_ctop_mappings")
        .select("agent_ctop_no, agent_ocsc_login_id, is_active, master_ctop_accounts(master_ctop_no)")
        .eq("partner_id", partnerData.id)
        .eq("is_active", true);
        
      setPartnerCtops(ctopData || []);

      const { data: msgData } = await supabase
        .from("partner_messages")
        .select("*")
        .eq("partner_id", partnerData.id)
        .order("created_at", { ascending: false });

      const fetchedMessages = msgData || [];
      setMessages(fetchedMessages);
      setUnreadCount(fetchedMessages.filter(m => !m.is_read).length);

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

      // Calculate Lifetime Pending Balance (Including Paybull and FRC/MNP)
      let lifetimeCash = 0;
      safeSales.forEach(s => {
        lifetimeCash += (
          Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0) + 
          Number(s.ctop_recharge_amt || 0) + Number(s.sim_replacement_amt || 0) + 
          Number(s.sim_fancy_amt || 0) + Number(s.sim_postpaid_amt || 0) + 
          Number(s.other_amt || 0) + Number(s.frc_amt || 0) + Number(s.mnp_amt || 0) +
          Number(s.pb_cbp_amt || 0) + Number(s.pb_ctop_amt || 0) + 
          Number(s.pb_frc_amt || 0) + Number(s.pb_mnp_amt || 0) + Number(s.pb_other_amt || 0)
        );
      });
      
      let lifetimeDep = 0;
      safeDeposits.filter(d => d.status !== 'Discrepancy').forEach(d => {
        lifetimeDep += Number(d.deposit_amount || 0);
      });

      setLifetimePendingBalance(lifetimeCash - lifetimeDep);
      applyTimeFilter("monthly", safeSales, safeDeposits);

    } catch (error) { 
      console.error(error); 
    }
  };

  const applyTimeFilter = (mode: string, sales = rawSales, deposits = rawDeposits) => {
    let startDate = new Date();
    
    if (mode === "today") {
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

    let cbp = 0, ctop = 0, simCash = 0, postpaidCash = 0, otherCash = 0, cheque = 0, pbCash = 0, totalSales = 0, totalDep = 0;
    let qN = 0, qU = 0, qR = 0, qF = 0, qP = 0, qM = 0;

    filteredSales.forEach(s => {
      const sCbp = Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0);
      const sCtop = Number(s.ctop_recharge_amt || 0);
      // FRC & MNP seamlessly route into SIM Cash Bucket
      const sSim = Number(s.sim_replacement_amt || 0) + Number(s.sim_fancy_amt || 0) + Number(s.frc_amt || 0) + Number(s.mnp_amt || 0); 
      const sPost = Number(s.sim_postpaid_amt || 0); 
      const sOther = Number(s.other_amt || 0); 
      // Paybull Isolation Bucket
      const sPbCash = Number(s.pb_cbp_amt || 0) + Number(s.pb_ctop_amt || 0) + Number(s.pb_frc_amt || 0) + Number(s.pb_mnp_amt || 0) + Number(s.pb_other_amt || 0);
      
      cbp += sCbp;
      ctop += sCtop;
      simCash += sSim;
      postpaidCash += sPost;
      otherCash += sOther;
      pbCash += sPbCash;
      cheque += Number(s.cheque_amt || 0);
      totalSales += (sCbp + sCtop + sSim + sPost + sOther + sPbCash);

      qN += Number(s.sim_new_qty || 0);
      qU += Number(s.sim_upgrade_qty || 0);
      qR += Number(s.sim_replacement_qty || 0);
      qF += Number(s.sim_fancy_qty || 0);
      qP += Number(s.sim_postpaid_qty || 0);
      qM += Number(s.mnp_qty || 0);
    });

    filteredDeposits.filter(d => d.status !== 'Discrepancy').forEach(d => {
      totalDep += Number(d.deposit_amount || 0);
    });

    setDisplayLedger({
      totalCBP: cbp, totalCTOP: ctop, totalSimCash: simCash, totalPostpaidCash: postpaidCash, 
      totalOtherCash: otherCash, totalPaybullCash: pbCash, totalCheque: cheque, 
      totalCashSales: totalSales, totalDeposits: totalDep,
      qNew: qN, qUp: qU, qRep: qR, qFan: qF, qPost: qP, qMnp: qM
    });
    setTimeFilter(mode);
  };

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

  // --- FIX: Restored Edit Request Handler ---
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

  const handleDocFileChange = (e: React.ChangeEvent<HTMLInputElement>, docName: string, isMulti: boolean) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      for (const file of selectedFiles) {
        if (file.size > 5 * 1024 * 1024) { 
          alert(`File size for ${file.name} must be under 5MB.`);
          e.target.value = ''; 
          return;
        }
      }
      if (isMulti) {
        if (selectedFiles.length !== 5) {
          alert(`Requirement Error: You must select exactly 5 photos for '${docName}'.`);
          e.target.value = '';
          setDocFiles(prev => ({ ...prev, [docName]: null }));
          return;
        }
        setDocFiles(prev => ({ ...prev, [docName]: selectedFiles }));
      } else {
        setDocFiles(prev => ({ ...prev, [docName]: selectedFiles[0] }));
      }
    }
  };

  const handleDocUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const requiredDocs = getRequiredDocuments(partner?.role);
    
    for (const doc of requiredDocs) {
      if (!docFiles[doc]) return alert(`Validation Error: Please upload the mandatory document: ${doc}`);
      if (doc.includes("(5 Nos)") && Array.isArray(docFiles[doc])) {
        if ((docFiles[doc] as File[]).length !== 5) return alert(`Validation Error: Please select exactly 5 photos for: ${doc}`);
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
        const fileOrFiles = docFiles[docName];
        if (!fileOrFiles) continue;

        const filesToProcess = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];

        for (let i = 0; i < filesToProcess.length; i++) {
          const file = filesToProcess[i];
          const arrayBuffer = await file.arrayBuffer();
          const mimeType = file.type.toLowerCase();
          
          const label = Array.isArray(fileOrFiles) ? `${docName} (Part ${i + 1}/5)` : docName;
          setDocUploadMessage(`Processing ${label}...`);

          if (mimeType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
            const loadedPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
            const copiedPages = await pdfDoc.copyPages(loadedPdf, loadedPdf.getPageIndices());
            
            copiedPages.forEach((page) => {
              pdfDoc.addPage(page);
              const { width } = page.getSize();
              page.drawRectangle({ x: 0, y: 0, width: width, height: 20, color: rgb(0, 0, 0) });
              page.drawText(`${label.toUpperCase()} | ${stampText}`, { x: 10, y: 6, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
            });
          } else if (mimeType.includes('jpeg') || mimeType.includes('jpg') || mimeType.includes('png')) {
            let image = (mimeType.includes('png')) ? await pdfDoc.embedPng(arrayBuffer) : await pdfDoc.embedJpg(arrayBuffer);
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
            page.drawText(`${label.toUpperCase()} | ${stampText}`, { x: 10, y: 8, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
          }
        }
      }

      setDocUploadMessage("Uploading secure Compliance PDF to Vault...");
      const mergedPdfBytes = await pdfDoc.save();
      const pdfFileName = `COMPLIANCE_${partner.id}_${Date.now()}.pdf`;

      const { error: uploadError, data } = await supabase.storage
        .from('application_documents')
        .upload(pdfFileName, mergedPdfBytes, { contentType: 'application/pdf' });

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from('active_partners').update({ compliance_docs_url: data.path }).eq('id', partner.id);
      if (dbError) throw dbError;

      setHasUploadedDocs(true);
      setDocUploadMessage("✅ Documents successfully locked and stored.");
      setTimeout(() => {
        setDocUploadMessage("");
        setIsDocModalOpen(false); // Close Modal on success
      }, 3000);

    } catch (error: any) {
      console.error(error);
      alert("Upload Failed: " + error.message);
      setDocUploadMessage("");
    } finally {
      setIsUploadingDocs(false);
    }
  };

  // --- FIX: Restored Download CSV & Sanitizer Logic ---
  const sanitize = (str: any) => `"${String(str || '').replace(/"/g, '""')}"`;

  const downloadCSV = () => {
    const startStr = timeFilter === "all" ? "2000-01-01" : 
                     timeFilter === "monthly" ? getLocalDateString(new Date(new Date().setDate(1))) :
                     timeFilter === "weekly" ? getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 7))) : 
                     getLocalDateString(new Date());

    const exportData = rawSales.filter(s => normalizeToYYYYMMDD(s.report_date) >= startStr);
    if (exportData.length === 0) return alert("No data to export for this time period.");

    const headers = [
      "Report Date", "CBP Landline", "CBP GSM", "CTOP Amount", "FRC Amount", "MNP Amount",
      "SIM New Qty", "SIM Upgrade Qty", "SIM Replace Qty", "SIM Replace Amt",
      "Fancy Qty", "Fancy Amt", "Postpaid Qty", "Postpaid Amt", "Paybull Cash", "Other Amount", "Cheque Amount", "Audited Status"
    ];

    const csvContent = [
      headers.join(","),
      ...exportData.map(s => {
        // Safe mapping of the newly introduced Paybull payload
        const pbCash = Number(s.pb_cbp_amt||0) + Number(s.pb_ctop_amt||0) + Number(s.pb_frc_amt||0) + Number(s.pb_mnp_amt||0) + Number(s.pb_other_amt||0);
        return [
          sanitize(formatToDDMMYYYY(s.report_date)),
          s.cbp_landline_amt || 0, s.cbp_gsm_amt || 0, s.ctop_recharge_amt || 0, s.frc_amt || 0, s.mnp_amt || 0,
          s.sim_new_qty || 0, s.sim_upgrade_qty || 0, s.sim_replacement_qty || 0, s.sim_replacement_amt || 0,
          s.sim_fancy_qty || 0, s.sim_fancy_amt || 0, s.sim_postpaid_qty || 0, s.sim_postpaid_amt || 0,
          pbCash, s.other_amt || 0, s.cheque_amt || 0, sanitize(s.is_edited_by_staff ? "Audited" : "Original")
        ].join(",");
      })
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

  const totalPrepaid = displayLedger.qNew + displayLedger.qUp + displayLedger.qRep + displayLedger.qFan + displayLedger.qMnp;
  const startStr = timeFilter === "all" ? "2000-01-01" : 
                   timeFilter === "monthly" ? getLocalDateString(new Date(new Date().setDate(1))) :
                   timeFilter === "weekly" ? getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 7))) : 
                   getLocalDateString(new Date());

  const visibleSales = rawSales.filter(s => normalizeToYYYYMMDD(s.report_date) >= startStr);
  const visibleDeposits = rawDeposits.filter(d => normalizeToYYYYMMDD(d.created_at) >= startStr);
  const requiredDocs = getRequiredDocuments(partner?.role);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      
      {/* ========================================================= */}
      {/* NATIVE APP STYLE TOP NAVIGATION BAR                       */}
      {/* ========================================================= */}
      <nav className="bg-blue-600 text-white px-4 md:px-8 py-4 flex justify-between items-center shadow-lg sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center font-black text-2xl text-blue-600 shadow-sm transform -rotate-12">F</div>
          <div>
            <h1 className="font-black text-lg leading-tight tracking-wide text-white">FAST ARK</h1>
            <p className="text-[9px] text-blue-200 font-bold uppercase tracking-widest">Partner Operations Hub</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 md:gap-5">
          <div className="hidden sm:flex bg-blue-700 border border-blue-500 px-3 py-1.5 rounded-lg text-right shadow-sm items-center gap-2 cursor-pointer hover:bg-blue-800 transition" title="View Inbox Below">
            <span className="text-xl animate-pulse">{unreadCount > 0 ? '🔔' : '🔕'}</span>
            <div>
              <p className="text-[9px] text-blue-200 font-black uppercase tracking-widest leading-none">Unread Alerts</p>
              <p className={`font-black text-xs ${unreadCount > 0 ? 'text-white' : 'text-blue-300'}`}>{unreadCount} Notices</p>
            </div>
          </div>
          <button onClick={handleSignOut} disabled={isLoggingOut} className="text-xs font-black text-blue-600 bg-white hover:bg-slate-100 px-4 py-2 rounded-lg shadow-sm transition uppercase tracking-widest">
            {isLoggingOut ? "Closing..." : "Logout"}
          </button>
        </div>
      </nav>

      <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">

        {/* ========================================================= */}
        {/* PRIORITY ACTION BUTTON (Compliance Modal Trigger)         */}
        {/* ========================================================= */}
        {!hasUploadedDocs ? (
          <button 
            onClick={() => setIsDocModalOpen(true)}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 px-6 rounded-xl shadow-lg border-2 border-red-800 flex flex-col md:flex-row items-center justify-between gap-4 transition transform hover:-translate-y-1 animate-in fade-in"
          >
            <div className="flex items-center gap-4 text-left">
              <span className="text-3xl md:text-4xl animate-pulse">🚨</span>
              <div>
                <h3 className="text-lg md:text-xl uppercase tracking-widest leading-tight">Action Required: Upload Compliance Docs</h3>
                <p className="text-xs font-bold text-red-200 mt-1">Your account requires mandatory documentation to maintain active status.</p>
              </div>
            </div>
            <span className="bg-white text-red-700 font-black px-5 py-2.5 rounded-lg text-sm uppercase tracking-widest shrink-0 shadow-sm w-full md:w-auto text-center">
              Tap to Upload ↗
            </span>
          </button>
        ) : (
          <div className="bg-emerald-100 text-emerald-800 border border-emerald-200 p-4 rounded-xl shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✅</span>
              <p className="font-black uppercase tracking-widest text-sm">Compliance Documents Secured</p>
            </div>
            <span className="text-[10px] font-bold opacity-70 bg-emerald-200 px-2 py-1 rounded">Locked & Validated</span>
          </div>
        )}

        {/* PRIORITY ALERTS */}
        {messages.filter(m => !m.is_read).length > 0 && (
          <div className="bg-red-50 border-l-4 border-red-600 p-5 rounded-r-xl shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
            <h3 className="font-black text-red-800 flex items-center gap-2 text-lg">
              <span className="text-2xl">⚠️</span> Unread Corporate Notices
            </h3>
            <p className="text-xs font-bold text-red-700 mb-3">You must acknowledge these notices in your Official Inbox (bottom of page).</p>
          </div>
        )}

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
            <div className="mt-4 md:mt-0 text-left md:text-right bg-red-800/50 p-3 rounded-lg border border-red-700">
              <p className="text-[10px] uppercase font-black text-red-300 tracking-widest">Pending Amount</p>
              <p className="text-3xl font-black">₹{lifetimePendingBalance.toLocaleString('en-IN')}</p>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* QUICK ACTIONS ROW (Prominent display for core tasks)      */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/partner/stock" className="bg-slate-900 p-5 rounded-xl shadow-md hover:shadow-lg transition-all border border-slate-800 hover:border-blue-500 group flex items-center gap-4 text-white">
            <div className="text-4xl shrink-0 group-hover:scale-110 transition duration-300">📦</div>
            <div>
              <h3 className="font-black text-sm uppercase tracking-widest text-blue-400">Stock Requisitions</h3>
              <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase">Request CBP, CTOP, or SIMs</p>
            </div>
          </Link>
          
          {hasSubmittedToday ? (
            <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-200 flex items-center gap-4 opacity-80 cursor-not-allowed">
              <div className="text-4xl shrink-0">✅</div>
              <div>
                <h3 className="font-black text-sm uppercase tracking-widest text-emerald-800">Sales Logged</h3>
                <p className="text-emerald-600 text-[10px] mt-1 font-bold uppercase">Today's report securely submitted</p>
              </div>
            </div>
          ) : (
            <Link href="/partner/sales" className="bg-blue-600 p-5 rounded-xl shadow-lg hover:bg-blue-700 border border-blue-500 transition-all group flex items-center gap-4 text-white transform hover:-translate-y-1">
              <div className="text-4xl shrink-0 group-hover:scale-110 transition duration-300">📊</div>
              <div>
                <h3 className="font-black text-sm uppercase tracking-widest">Daily Sales Entry</h3>
                <p className="text-blue-200 text-[10px] mt-1 font-bold uppercase">Log end-of-day revenue</p>
              </div>
            </Link>
          )}

          <Link href="/partner/deposit" className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all hover:border-emerald-500 group flex items-center gap-4">
            <div className="text-4xl shrink-0 group-hover:scale-110 transition duration-300">💳</div>
            <div>
              <h3 className="font-black text-sm uppercase tracking-widest text-slate-900 group-hover:text-emerald-600">Deposit of Sales</h3>
              <p className="text-slate-500 text-[10px] mt-1 font-bold uppercase">Settle balance & upload slips</p>
            </div>
          </Link>
        </div>

        {/* ========================================================= */}
        {/* MOBILE OPTIMIZED ACCORDION MENUS (Infrastructure Cards)   */}
        {/* ========================================================= */}
        <div className="space-y-3 pt-2">
          
          {/* Accordion 1: Partner Profile */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button onClick={() => setExpandedCard(expandedCard === 'profile' ? null : 'profile')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
              <div className="flex items-center gap-3">
                <span className="text-xl">👤</span>
                <div className="text-left">
                  <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Partner Profile & Center</h3>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{partner?.locations?.center_name || "Unassigned Center"}</p>
                </div>
              </div>
              <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'profile' ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {expandedCard === 'profile' && (
              <div className="p-5 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6 bg-white animate-in slide-in-from-top-2">
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest border-b pb-1">Personal Details</p>
                  <div><p className="text-[10px] font-bold text-slate-400 uppercase">Full Name</p><p className="font-black text-slate-800">{partner?.partner_name}</p></div>
                  <div><p className="text-[10px] font-bold text-slate-400 uppercase">Email ID</p><p className="font-bold text-slate-800 text-sm break-all">{partner?.email}</p></div>
                  <div><p className="text-[10px] font-bold text-slate-400 uppercase">Mobile No</p><p className="font-bold text-slate-800 text-sm">{partner?.mobile || partner?.phone || "N/A"}</p></div>
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase text-emerald-600 tracking-widest border-b pb-1">Assigned Center Details</p>
                  <div><p className="text-[10px] font-bold text-slate-400 uppercase">Center Code</p><p className="font-black text-slate-800 bg-slate-100 inline-block px-2 py-0.5 rounded">{partner?.locations?.center_code || "NO-CODE"}</p></div>
                  <div><p className="text-[10px] font-bold text-slate-400 uppercase">Role</p><p className="font-black text-slate-800">{partner?.role}</p></div>
                  <div><p className="text-[10px] font-bold text-slate-400 uppercase">Geographic Zone</p><p className="text-sm font-bold text-slate-700 leading-relaxed">{partner?.locations?.taluk ? `${partner?.locations.taluk}, ` : ""}{partner?.locations?.dist}<br/>{partner?.locations?.state} - {partner?.locations?.pin_code}</p></div>
                </div>
              </div>
            )}
          </div>

          {/* Accordion 2: Telecom & OCSC */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button onClick={() => setExpandedCard(expandedCard === 'telecom' ? null : 'telecom')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
              <div className="flex items-center gap-3">
                <span className="text-xl">📡</span>
                <div className="text-left">
                  <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Telecom & OCSC Credentials</h3>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{partnerCtops.length} Mapped Agents</p>
                </div>
              </div>
              <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'telecom' ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {expandedCard === 'telecom' && (
              <div className="p-5 border-t border-slate-200 bg-white animate-in slide-in-from-top-2">
                {partnerCtops.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 text-center py-4 bg-slate-50 rounded-lg border border-slate-100">No CTOP credentials mapped to this account.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {partnerCtops.map((ctop, idx) => (
                      <div key={idx} className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 shadow-sm relative overflow-hidden">
                        <div className="absolute right-0 top-0 text-4xl opacity-10 mt-2 mr-2">🔐</div>
                        <p className="text-[9px] font-black text-blue-800 uppercase tracking-widest mb-3 border-b border-blue-200 pb-2">Master: {ctop.master_ctop_accounts?.master_ctop_no}</p>
                        <div className="mb-3">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Partner CTOP No</p>
                          <p className="font-black text-xl text-slate-900 tracking-wider">{ctop.agent_ctop_no}</p>
                        </div>
                        {ctop.agent_ocsc_login_id && (
                          <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">OCSC Login ID</p>
                            <p className="font-bold text-slate-800 break-all">{ctop.agent_ocsc_login_id}</p>
                          </div>
                        )}
                        {!ctop.is_active && <div className="mt-3 bg-red-100 border border-red-200 p-1.5 rounded text-center"><p className="text-[9px] font-black text-red-700 uppercase tracking-widest">⚠️ Suspended</p></div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Accordion 3: Treasury (Virtual & UPI) */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button onClick={() => setExpandedCard(expandedCard === 'treasury' ? null : 'treasury')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
              <div className="flex items-center gap-3">
                <span className="text-xl">🏦</span>
                <div className="text-left">
                  <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Bank Treasury Channels</h3>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{virtualAccounts.length} CMS Accts | {upiIds.length} UPIs</p>
                </div>
              </div>
              <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'treasury' ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {expandedCard === 'treasury' && (
              <div className="p-5 border-t border-slate-200 bg-white grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2">
                <div>
                  <p className="text-[10px] font-black uppercase text-amber-700 tracking-widest border-b border-amber-200 pb-1 mb-3">Virtual Accounts (CMS)</p>
                  {virtualAccounts.length === 0 ? <p className="text-xs font-bold text-slate-400 bg-slate-50 p-4 rounded text-center border border-slate-100">No virtual accounts assigned.</p> : (
                    <div className="space-y-3">
                      {virtualAccounts.map((va, idx) => (
                        <div key={idx} className={`p-3 rounded-lg border ${va.is_active ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50 opacity-70 grayscale'}`}>
                          <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1">{va.master_banks?.bank_name}</p>
                          <p className="font-black text-lg text-slate-900 tracking-wider">{va.virtual_account_no}</p>
                          <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase">IFSC: <span className="text-slate-800">{va.virtual_ifsc}</span></p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-purple-700 tracking-widest border-b border-purple-200 pb-1 mb-3">Digital UPI Channels</p>
                  {upiIds.length === 0 ? <p className="text-xs font-bold text-slate-400 bg-slate-50 p-4 rounded text-center border border-slate-100">No UPI channels assigned.</p> : (
                    <div className="space-y-3">
                      {upiIds.map((upi, idx) => (
                        <div key={idx} className={`p-3 rounded-lg border ${upi.is_active ? 'border-purple-200 bg-purple-50/50' : 'border-slate-200 bg-slate-50 opacity-70 grayscale'}`}>
                          <p className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-1">{upi.master_banks?.bank_name}</p>
                          <p className="font-black text-base text-slate-900 break-all">{upi.upi_id}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Accordion 4: Store Assets */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button onClick={() => setExpandedCard(expandedCard === 'assets' ? null : 'assets')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
              <div className="flex items-center gap-3">
                <span className="text-xl">🖨️</span>
                <div className="text-left">
                  <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Store Assets & Printables</h3>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Official Center QR Code</p>
                </div>
              </div>
              <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'assets' ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {expandedCard === 'assets' && (
              <div className="p-6 border-t border-slate-200 bg-white animate-in slide-in-from-top-2 text-center">
                {partner?.locations?.qr_asset_url ? (
                  <div className="inline-block p-5 border-2 border-dashed border-blue-200 bg-blue-50 rounded-2xl w-full max-w-sm mx-auto shadow-sm">
                    <div className="text-5xl mb-3 animate-bounce">🖼️</div>
                    <h4 className="font-black text-blue-900 text-base mb-1 uppercase tracking-widest">Official Store QR Code</h4>
                    <p className="text-[10px] text-blue-700 font-bold mb-5 uppercase">Mapped specifically to {partner?.locations?.center_name}</p>
                    <a 
                      href={partner.locations.qr_asset_url} 
                      target="_blank" 
                      rel="noreferrer"
                      download={`FastArk_QR_${partner?.locations?.center_code || 'Asset'}.png`}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-black py-3 px-6 rounded-xl shadow-md text-xs uppercase tracking-widest transition block w-full"
                    >
                      Download Asset
                    </a>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 opacity-70 bg-slate-50 rounded-2xl border border-slate-200 w-full max-w-sm mx-auto">
                    <div className="text-4xl mb-3">🚫</div>
                    <p className="text-sm font-black text-slate-700 uppercase tracking-widest">No Custom QR Mapped</p>
                    <p className="text-[10px] text-slate-500 mt-1 font-bold uppercase">Please Contact Corporate Admin</p>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* ========================================================= */}
        {/* SECTION: LIVE FINANCIAL LEDGER                            */}
        {/* ========================================================= */}
        <div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden mt-8">
          
          <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-white font-black text-lg tracking-wide">Operational Ledger</h2>
              <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-900/50 text-emerald-400 px-3 py-1 rounded-full border border-emerald-800 mt-2 inline-block shadow-sm">
                Live Auditing
              </span>
            </div>
            
            <div className="flex bg-slate-800 rounded-lg p-1 overflow-x-auto w-full md:w-auto border border-slate-700">
              {['today', 'weekly', 'monthly', 'all'].map(mode => (
                <button 
                  key={mode} 
                  onClick={() => applyTimeFilter(mode)} 
                  className={`px-4 py-2 rounded-md text-[10px] font-black uppercase tracking-wider transition flex-1 text-center whitespace-nowrap ${timeFilter === mode ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-px bg-slate-800">
            <div className="col-span-1 lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-px bg-slate-800">
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">CBP Sales</p><p className="text-2xl font-black text-white">₹{displayLedger.totalCBP.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">CTOP Sales</p><p className="text-2xl font-black text-white">₹{displayLedger.totalCTOP.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">BSNL SIM Cash</p><p className="text-2xl font-black text-white">₹{displayLedger.totalSimCash.toLocaleString('en-IN')}</p></div>
              
              <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800"><p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">Paybull Platform Cash</p><p className="text-xl font-black text-blue-400">₹{displayLedger.totalPaybullCash.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800"><p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Other Adjustments</p><p className="text-xl font-black text-emerald-400">₹{displayLedger.totalOtherCash.toLocaleString('en-IN')}</p></div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800"><p className="text-[10px] text-amber-500/70 font-bold uppercase tracking-widest mb-1">Cheques Deposited</p><p className="text-xl font-black text-amber-500">₹{displayLedger.totalCheque.toLocaleString('en-IN')}</p></div>
            </div>
            
            <div className="col-span-1 bg-slate-900 p-6 flex flex-col justify-center border-t-4 lg:border-t-0 lg:border-l-4 border-blue-600 shadow-inner">
              <div className="mb-6"><p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-1">Total Generated</p><p className="text-4xl font-black text-white">₹{displayLedger.totalCashSales.toLocaleString('en-IN')}</p></div>
              <div><p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-1">Total Remitted</p><p className="text-3xl font-black text-white">₹{displayLedger.totalDeposits.toLocaleString('en-IN')}</p></div>
            </div>
          </div>
          
          <div className="bg-slate-800 p-4 border-t border-b border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h3 className="font-black text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2"><span>📱</span> SIM Activations ({timeFilter})</h3>
            <div className="flex flex-wrap gap-2 md:gap-4 w-full md:w-auto">
              <span className="bg-blue-900/50 text-blue-300 font-black px-3 py-1.5 rounded-lg text-[10px] border border-blue-800 uppercase tracking-widest flex-1 text-center">Prepaid: {totalPrepaid}</span>
              <span className="bg-purple-900/50 text-purple-300 font-black px-3 py-1.5 rounded-lg text-[10px] border border-purple-800 uppercase tracking-widest flex-1 text-center">Postpaid: {displayLedger.qPost}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-slate-700">
            <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">New</p><p className="text-xl font-black text-white">{displayLedger.qNew}</p></div>
            <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Upgrade</p><p className="text-xl font-black text-white">{displayLedger.qUp}</p></div>
            <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Replace</p><p className="text-xl font-black text-white">{displayLedger.qRep}</p></div>
            <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Fancy</p><p className="text-xl font-black text-white">{displayLedger.qFan}</p></div>
            <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">MNP</p><p className="text-xl font-black text-blue-300">{displayLedger.qMnp}</p></div>
            <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Postpaid</p><p className="text-xl font-black text-purple-300">{displayLedger.qPost}</p></div>
          </div>

          <div className={`p-6 text-center ${lifetimePendingBalance > 0 ? 'bg-red-950 border-t border-red-900' : 'bg-emerald-950 border-t border-emerald-900'}`}>
            <span className={`font-black text-sm uppercase tracking-widest mr-2 block sm:inline ${lifetimePendingBalance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {lifetimePendingBalance > 0 ? '⚠️ Total Pending Cash to Deposit:' : '✅ Ledger Settled:'}
            </span>
            <span className="text-3xl font-black text-white mt-1 sm:mt-0 inline-block">₹{Math.max(0, lifetimePendingBalance).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
            <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-widest">*Pending balance is calculated across lifetime operations (BSNL + Paybull).</p>
          </div>
        </div>

        {/* BOTTOM GRID: HISTORICAL LOGS & CORPORATE INBOX */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          
          {/* Sales History */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
              <h2 className="font-black text-slate-800 uppercase tracking-widest text-xs">Sales Reports ({timeFilter})</h2>
              <button onClick={downloadCSV} className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded font-black uppercase tracking-widest hover:bg-blue-100 transition shadow-sm">
                📥 Export CSV
              </button>
            </div>
            <div className="p-0">
              {visibleSales.length === 0 ? <p className="p-8 text-center text-sm font-bold text-slate-400 bg-slate-50">No sales submitted in this period.</p> : (
                <ul className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                  {visibleSales.map(sale => {
                    // Safe calculation including the new columns
                    const totalCash = Number(sale.cbp_landline_amt || 0) + Number(sale.cbp_gsm_amt || 0) + 
                                      Number(sale.ctop_recharge_amt || 0) + Number(sale.sim_replacement_amt || 0) + 
                                      Number(sale.sim_fancy_amt || 0) + Number(sale.sim_postpaid_amt || 0) + 
                                      Number(sale.other_amt || 0) + Number(sale.frc_amt || 0) + Number(sale.mnp_amt || 0) + 
                                      Number(sale.pb_cbp_amt || 0) + Number(sale.pb_ctop_amt || 0) + 
                                      Number(sale.pb_frc_amt || 0) + Number(sale.pb_mnp_amt || 0) + Number(sale.pb_other_amt || 0);

                    const totalSims = Number(sale.sim_new_qty || 0) + Number(sale.sim_upgrade_qty || 0) + 
                                      Number(sale.sim_replacement_qty || 0) + Number(sale.sim_fancy_qty || 0) + 
                                      Number(sale.sim_postpaid_qty || 0) + Number(sale.mnp_qty || 0) + Number(sale.frc_qty || 0);

                    const pbCash = Number(sale.pb_cbp_amt || 0) + Number(sale.pb_ctop_amt || 0) + 
                                   Number(sale.pb_frc_amt || 0) + Number(sale.pb_mnp_amt || 0) + Number(sale.pb_other_amt || 0);

                    const isExpanded = expandedSaleId === sale.id;

                    return (
                      <li key={sale.id} className="transition">
                        <div className="p-4 hover:bg-slate-50 flex justify-between items-center cursor-pointer" onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}>
                          <div>
                            <p className="font-black text-slate-900 text-base">{formatToDDMMYYYY(sale.report_date)}</p>
                            <div className="flex flex-wrap gap-2 mt-1.5">
                              {sale.is_edited_by_staff ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-widest rounded border border-amber-200">Audited</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-widest rounded border border-emerald-200">Original</span>
                              )}
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-black uppercase tracking-widest rounded border border-blue-200">{totalSims} SIMs</span>
                              {pbCash > 0 && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase tracking-widest rounded border border-indigo-200">PB: ₹{pbCash}</span>}
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end">
                            <p className="font-black text-slate-800 text-lg">₹{totalCash.toLocaleString('en-IN')}</p>
                            <span className="text-[10px] text-blue-600 font-black uppercase tracking-widest mt-1 flex items-center hover:underline">
                              {isExpanded ? 'Hide Details ▲' : 'View Details ▼'}
                            </span>
                          </div>
                        </div>
                        
                        {isExpanded && (
                          <div className="bg-slate-800 p-5 border-t border-slate-700 animate-in fade-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-y-5 gap-x-3">
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CBP LL</p><p className="text-sm font-bold text-white">₹{sale.cbp_landline_amt || 0}</p></div>
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CBP GSM</p><p className="text-sm font-bold text-white">₹{sale.cbp_gsm_amt || 0}</p></div>
                              <div><p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">CTOP</p><p className="text-sm font-bold text-blue-300">₹{sale.ctop_recharge_amt || 0}</p></div>
                              <div><p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">FRC</p><p className="text-sm font-bold text-emerald-300">₹{sale.frc_amt || 0}</p></div>
                              <div><p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Cheque</p><p className="text-sm font-bold text-amber-500">₹{sale.cheque_amt || 0}</p></div>
                              
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">New SIM</p><p className="text-sm font-bold text-white">{sale.sim_new_qty || 0}</p></div>
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Upgrade</p><p className="text-sm font-bold text-white">{sale.sim_upgrade_qty || 0}</p></div>
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Replace</p><p className="text-sm font-bold text-white">{sale.sim_replacement_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_replacement_amt || 0})</span></p></div>
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fancy</p><p className="text-sm font-bold text-white">{sale.sim_fancy_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_fancy_amt || 0})</span></p></div>
                              <div><p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">MNP</p><p className="text-sm font-bold text-white">{sale.mnp_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.mnp_amt || 0})</span></p></div>
                              <div><p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">Postpaid</p><p className="text-sm font-bold text-white">{sale.sim_postpaid_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_postpaid_amt || 0})</span></p></div>
                              
                              {/* Paybull Breakdown */}
                              {pbCash > 0 && (
                                <div className="col-span-2 sm:col-span-3 md:col-span-5 pt-4 mt-2 border-t border-slate-700 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                  <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-3">Paybull Platform Cash</p>
                                  <div className="flex flex-wrap gap-4">
                                    {sale.pb_cbp_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">CBP</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_cbp_amt}</p></div>}
                                    {sale.pb_ctop_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">CTOP</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_ctop_amt}</p></div>}
                                    {sale.pb_frc_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">FRC</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_frc_amt}</p></div>}
                                    {sale.pb_mnp_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">MNP</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_mnp_amt}</p></div>}
                                    {sale.pb_other_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">Other</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_other_amt}</p></div>}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-700">
                              {sale.edit_request_status === 'Pending' ? (
                                <div className="bg-amber-900/30 border border-amber-800 p-3 rounded-lg flex items-center justify-between">
                                  <span className="text-amber-500 font-bold text-[10px] uppercase tracking-widest">⏳ Edit Request Pending</span>
                                  <span className="text-slate-400 text-[10px] truncate max-w-[150px]">Reason: {sale.edit_request_reason}</span>
                                </div>
                              ) : sale.edit_request_status === 'Approved' ? (
                                <div className="bg-emerald-900/30 border border-emerald-800 p-3 rounded-lg flex items-center justify-between">
                                  <span className="text-emerald-500 font-bold text-[10px] uppercase tracking-widest">✅ Edit Request Approved</span>
                                  <Link href={`/partner/sales`} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded font-black text-[10px] uppercase tracking-widest transition shadow">Edit Now</Link>
                                </div>
                              ) : sale.edit_request_status === 'Rejected' ? (
                                <div className="bg-red-900/30 border border-red-800 p-3 rounded-lg flex flex-col">
                                  <span className="text-red-500 font-black text-[10px] uppercase tracking-widest mb-1">❌ Edit Request Rejected</span>
                                  <span className="text-slate-400 text-[10px]">Your request to edit was declined by the back-office.</span>
                                </div>
                              ) : (
                                requestingEditId === sale.id ? (
                                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                                    <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">Reason for Edit Request *</label>
                                    <input 
                                      type="text" value={editReason} onChange={e => setEditReason(e.target.value)} 
                                      placeholder="e.g. Typo in CTOP cash amount..." 
                                      className="w-full bg-slate-800 text-white border-2 border-slate-600 rounded-lg p-3 text-xs outline-none mb-3 focus:border-amber-500 font-bold"
                                    />
                                    <div className="flex gap-2">
                                      <button onClick={() => handleRequestEdit(sale.id)} className="flex-1 bg-amber-600 hover:bg-amber-700 text-slate-900 font-black py-2.5 rounded-lg text-[10px] uppercase tracking-widest transition shadow-sm">Submit Request</button>
                                      <button onClick={() => setRequestingEditId(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-black py-2.5 rounded-lg text-[10px] uppercase tracking-widest transition shadow-sm">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => setRequestingEditId(sale.id)} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-3 rounded-xl text-[10px] uppercase tracking-widest transition border border-slate-600 flex justify-center items-center gap-2 shadow-sm">
                                    <span>⚠</span> Request Permission to Edit Report
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
              <div className="p-4 border-b bg-slate-50"><h2 className="font-black text-slate-800 uppercase tracking-widest text-xs">Deposit of Sales ({timeFilter})</h2></div>
              <div className="p-0">
                {visibleDeposits.length === 0 ? <p className="p-8 text-center text-sm font-bold text-slate-400 bg-slate-50">No deposits submitted in this period.</p> : (
                  <ul className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                    {visibleDeposits.map(dep => (
                      <li key={dep.id} className="p-4 hover:bg-slate-50 flex justify-between items-center transition">
                        <div>
                          <p className="font-black text-slate-900">{formatToDDMMYYYY(dep.created_at)}</p>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest mt-1.5 inline-block border shadow-sm ${dep.status === 'Verified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : dep.status === 'Discrepancy' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                            {dep.status}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className={`font-black text-lg ${dep.status === 'Discrepancy' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>₹{Number(dep.deposit_amount).toLocaleString('en-IN')}</p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{dep.deposit_method}</p>
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
                  <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">Official Notices & Audit Alerts</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black">{messages.length}</p>
                  <p className="text-[9px] text-blue-400 uppercase tracking-widest font-black">Total Records</p>
                </div>
              </div>
              
              <div className="overflow-y-auto flex-1 p-4 bg-slate-50">
                {messages.length === 0 ? (
                  <div className="text-center p-10 bg-white rounded-xl border border-slate-100">
                    <span className="text-5xl mb-4 block">📭</span>
                    <p className="text-slate-700 font-black uppercase tracking-widest text-sm">Your inbox is clear.</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">No corporate alerts issued.</p>
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
                            isUnread ? 'bg-white border-blue-300' : 'bg-slate-100 border-slate-200 opacity-80 hover:opacity-100'
                          }`}
                        >
                          <div className="p-4 flex gap-4 items-start">
                            <div className="shrink-0 mt-1">
                              {isUnread ? (
                                <span className="relative flex h-4 w-4">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-600"></span>
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
                                <span className="inline-block mt-2 text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
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
                                  <span className="text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                                    Global Broadcast
                                  </span>
                                )}
                              </div>
                              
                              <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed font-medium bg-slate-50 p-4 rounded-xl border border-slate-200">
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
              
              <div className="bg-slate-100 p-3 border-t border-slate-200 flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-500 shrink-0">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600"></span> Unread Alert</span>
                <span className="flex items-center gap-1">✅ Read & Logged</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================= */}
      {/* 🔴 ACTION MODAL: MANDATORY COMPLIANCE DOCUMENTS UPLOAD    */}
      {/* ========================================================= */}
      {isDocModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex justify-center items-end md:items-center p-0 md:p-4 animate-in fade-in">
          
          <div className="bg-white w-full max-w-2xl rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-10 md:zoom-in-95">
            
            {/* Modal Header */}
            <div className="bg-slate-900 p-5 flex justify-between items-center shrink-0">
              <div className="text-white">
                <h2 className="font-black text-lg tracking-wide flex items-center gap-2"><span>📂</span> Mandatory Compliance</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Upload required operational documents</p>
              </div>
              <button onClick={() => !isUploadingDocs && setIsDocModalOpen(false)} className="text-slate-400 hover:text-white text-3xl font-black transition">&times;</button>
            </div>
            
            {/* Modal Body (Scrollable) */}
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50">
               {hasUploadedDocs ? (
                  <div className="text-center p-8 bg-emerald-50 border border-emerald-200 rounded-2xl mt-4 shadow-sm">
                     <span className="text-5xl mb-4 block">🔒</span>
                     <h3 className="font-black text-emerald-800 text-lg uppercase tracking-widest">Documents Submitted</h3>
                     <p className="text-sm font-bold text-emerald-700 mt-2">Your compliance documents have been securely merged, watermarked, and locked.</p>
                  </div>
               ) : (
                  <form id="compliance-form" onSubmit={handleDocUploadSubmit} className="space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {requiredDocs.map((docName, idx) => {
                           const isMulti = docName.includes("(5 Nos)");
                           const fileData = docFiles[docName];
                           const fileCount = Array.isArray(fileData) ? fileData.length : (fileData ? 1 : 0);

                           return (
                             <div key={idx} className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm hover:border-blue-300 transition">
                                <label className="block text-xs font-black text-slate-700 uppercase tracking-widest mb-3 leading-tight border-b border-slate-100 pb-2">
                                  {idx + 1}. {docName} *
                                  {isMulti && <span className="block text-[10px] text-blue-600 mt-1.5 normal-case font-bold">Please select exactly 5 images at once.</span>}
                                </label>
                                <input 
                                   type="file" 
                                   accept=".pdf, .jpg, .jpeg, .png" 
                                   required={!docFiles[docName]}
                                   multiple={isMulti}
                                   onChange={(e) => handleDocFileChange(e, docName, isMulti)}
                                   className="w-full text-xs font-medium text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-[10px] file:uppercase file:tracking-widest file:font-black file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                                />
                                {isMulti && fileCount > 0 && (
                                  <p className={`text-[10px] font-black uppercase tracking-widest mt-3 px-2 py-1.5 rounded inline-block border ${fileCount === 5 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                                    {fileCount} / 5 files selected
                                  </p>
                                )}
                             </div>
                           );
                        })}
                     </div>
                     
                     {docUploadMessage && (
                        <div className="p-4 bg-blue-50 text-blue-800 text-xs font-black uppercase tracking-widest rounded-xl border border-blue-200 text-center animate-pulse shadow-sm">
                           {docUploadMessage}
                        </div>
                     )}
                  </form>
               )}
            </div>
            
            {/* Modal Footer (Sticky) */}
            {!hasUploadedDocs && (
              <div className="p-5 bg-white border-t border-slate-200 shrink-0">
                 <button 
                    form="compliance-form"
                    type="submit" 
                    disabled={isUploadingDocs}
                    className="w-full py-4 bg-slate-900 text-white font-black rounded-xl shadow-lg uppercase tracking-widest hover:bg-blue-600 transition disabled:opacity-50 flex justify-center items-center gap-2"
                 >
                    {isUploadingDocs ? "Processing & Watermarking..." : "Submit & Lock Documents"}
                 </button>
              </div>
            )}
            
          </div>
        </div>
      )}

    </div>
  );
}