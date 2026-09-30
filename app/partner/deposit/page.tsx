"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { QRCodeSVG } from "qrcode.react"; 
import Tesseract from "tesseract.js";

// --- Date Normalizer Utility ---
const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

// Converts parsed text dates into YYYY-MM-DD for <input type="date">
const parseExtractedDate = (text: string): string | null => {
  const monthMap: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };

  // Pattern 1: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = text.match(/\b([0-3]?\d)[\/\-\.]([0-1]?\d)[\/\-\.](202\d)\b/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Pattern 2: DD Month YYYY (e.g. 28 Sep 2026 or 28 September 2026)
  const ddMonYyyy = text.match(/\b([0-3]?\d)\s+([A-Za-z]{3,9})\s+(202\d)\b/);
  if (ddMonYyyy) {
    const day = ddMonYyyy[1].padStart(2, "0");
    const monStr = ddMonYyyy[2].toLowerCase().substring(0, 3);
    const month = monthMap[monStr];
    const year = ddMonYyyy[3];
    if (month) return `${year}-${month}-${day}`;
  }

  // Pattern 3: Month DD, YYYY (e.g. Sep 28, 2026)
  const monDdYyyy = text.match(/\b([A-Za-z]{3,9})\s+([0-3]?\d),?\s+(202\d)\b/);
  if (monDdYyyy) {
    const monStr = monDdYyyy[1].toLowerCase().substring(0, 3);
    const day = monDdYyyy[2].padStart(2, "0");
    const month = monthMap[monStr];
    const year = monDdYyyy[3];
    if (month) return `${year}-${month}-${day}`;
  }

  return null;
};

export default function PartnerDepositPage() {
  const router = useRouter();
  const [partner, setPartner] = useState<any>(null);
  const [companyBanks, setCompanyBanks] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  
  // Data States
  const [deposits, setDeposits] = useState<any[]>([]);
  const [matchedRows, setMatchedRows] = useState<Set<string>>(new Set()); 
  
  // Submission Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    deposit_amount: "",
    deposit_method: "UPI",
    reference_no: "",
    deposit_date: getLocalDateString(new Date()),
  });

  // Slip, Exemption, Preset & OCR States
  const [slipTypePreset, setSlipTypePreset] = useState("auto");
  const [slipImage, setSlipImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  // Scanned Extracted Snapshot for Audit
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [ocrRawAmount, setOcrRawAmount] = useState<number | null>(null);
  const [ocrRawRef, setOcrRawRef] = useState<string | null>(null);
  const [ocrRawDate, setOcrRawDate] = useState<string | null>(null);
  const [isUserVerified, setIsUserVerified] = useState(false);

  const [isExempted, setIsExempted] = useState(false);
  const [exemptionCategory, setExemptionCategory] = useState("");
  const [otherExemptionText, setOtherExemptionText] = useState("");

  // Edit / Correction States for Ledger Grid
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    initializePortal();
  }, [router]);

  const initializePortal = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

      const { data: partnerData, error: partnerError } = await supabase
        .from("active_partners")
        .select("id, center_id, partner_name, locations(center_name)")
        .ilike("email", session.user.email || "")
        .maybeSingle();

      if (partnerError || !partnerData) throw new Error("Partner profile not found.");
      setPartner(partnerData);

      // Fetch Deposits for Ledger Grid
      const { data: depData } = await supabase
        .from("partner_deposits")
        .select("*")
        .eq("partner_id", partnerData.id)
        .order("created_at", { ascending: false });

      setDeposits(depData || []);

      // Fetch Company UPI ID for QR Generation
      const { data: banks } = await supabase
        .from("company_bank_accounts")
        .select("upi_id")
        .eq("is_active", true)
        .not("upi_id", "is", null)
        .limit(1);
        
      setCompanyBanks(banks || []);

    } catch (err: any) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- ADVANCED CLIENT-SIDE MULTI-TEMPLATE OCR ENGINE ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSlipImage(file);
    setImagePreview(URL.createObjectURL(file));
    setIsScanning(true);
    setScanProgress(0);
    setIsExempted(false);
    setIsUserVerified(false);
    setDetectedPlatform(null);
    setOcrRawAmount(null);
    setOcrRawRef(null);
    setOcrRawDate(null);

    try {
      const worker = await Tesseract.createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text" && m.progress) {
            setScanProgress(Math.round(m.progress * 100));
          }
        },
      });

      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      console.log("=== RAW OCR TEXT ===");
      console.log(text);

      const raw = text.toLowerCase();

      // 1. Detect Slip / Source Type
      let identifiedType = "Generic Slip";
      let assignedMethod = form.deposit_method;

      if (slipTypePreset === "gpay" || raw.includes("google pay") || raw.includes("gpay")) {
        identifiedType = "Google Pay";
        assignedMethod = "UPI";
      } else if (slipTypePreset === "phonepe" || raw.includes("phonepe")) {
        identifiedType = "PhonePe";
        assignedMethod = "UPI";
      } else if (slipTypePreset === "paytm" || raw.includes("paytm")) {
        identifiedType = "Paytm";
        assignedMethod = "UPI";
      } else if (
        slipTypePreset === "cash_slip" ||
        raw.includes("cash deposit") ||
        raw.includes("denominations") ||
        raw.includes("challan") ||
        raw.includes("teller") ||
        raw.includes("scroll")
      ) {
        identifiedType = "Bank Cash Slip";
        assignedMethod = "Cash Deposit";
      } else if (
        slipTypePreset === "neft_imps" ||
        raw.includes("neft") ||
        raw.includes("rtgs") ||
        raw.includes("imps") ||
        raw.includes("netbanking")
      ) {
        identifiedType = raw.includes("imps") ? "IMPS" : "NEFT/RTGS";
        assignedMethod = identifiedType;
      } else if (raw.includes("upi") || raw.includes("unified payments")) {
        identifiedType = "UPI Transaction";
        assignedMethod = "UPI";
      }

      setDetectedPlatform(identifiedType);

      // 2. Extract Reference / UTR Number
      let extractedRef = "";
      const labeledRefMatch = text.match(
        /(?:upi\s*ref(?:\s*no|\s*id)?|utr(?:\s*no)?|txn(?:\s*id)?|transaction\s*id|journal(?:\s*no)?|scroll(?:\s*no)?|challan(?:\s*no)?)[:\s#.-]*([A-Za-z0-9]{6,22})/i
      );

      if (labeledRefMatch && labeledRefMatch[1]) {
        extractedRef = labeledRefMatch[1].trim();
      } else {
        const upi12DigitMatch = text.match(/\b\d{12}\b/);
        if (upi12DigitMatch) {
          extractedRef = upi12DigitMatch[0];
        }
      }

      if (extractedRef) {
        setOcrRawRef(extractedRef);
      }

      // 3. Extract Amount
      let extractedAmount = 0;
      const currencyMatch = text.match(/(?:[₹]|rs\.?|inr|amt|amount|paid)\s*[:\s]*([0-9,]+(?:\.[0-9]{2})?)/i);
      
      if (currencyMatch && currencyMatch[1]) {
        const val = parseFloat(currencyMatch[1].replace(/,/g, ""));
        if (!isNaN(val) && val > 0 && val <= 1000000) {
          extractedAmount = val;
        }
      }

      if (extractedAmount === 0) {
        const numbers = text.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b|\b\d+\b/g);
        if (numbers) {
          const numericValues = numbers
            .map((str) => parseFloat(str.replace(/,/g, "")))
            .filter((num) => {
              if (num >= 2024 && num <= 2030) return false;
              if (num > 1000000) return false;
              if (num.toString().length >= 10) return false;
              return num > 0;
            });

          if (numericValues.length > 0) {
            extractedAmount = Math.max(...numericValues);
          }
        }
      }

      if (extractedAmount > 0) {
        setOcrRawAmount(extractedAmount);
      }

      // 4. Extract Date
      const parsedDate = parseExtractedDate(text);
      if (parsedDate) {
        setOcrRawDate(parsedDate);
      }

      // 5. Populate Form Fields
      setForm((prev) => ({
        ...prev,
        deposit_amount: extractedAmount > 0 ? extractedAmount.toString() : prev.deposit_amount,
        reference_no: extractedRef.length >= 4 ? extractedRef : prev.reference_no,
        deposit_method: assignedMethod,
        deposit_date: parsedDate || prev.deposit_date,
      }));

    } catch (err: any) {
      console.error("Browser OCR Scanning Error:", err);
      alert("Slip scanning failed. Please verify the document manually.");
    } finally {
      setIsScanning(false);
    }
  };

  // --- SUBMIT NEW DEPOSIT ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isExempted && slipImage && !isUserVerified) {
      return alert("⚠️ Please review all auto-scanned fields and check the confirmation box before submitting.");
    }

    const amt = parseFloat(form.deposit_amount);
    if (isNaN(amt) || amt <= 0) return alert("Amount must be greater than zero.");
    if (form.reference_no.trim().length < 4) return alert("Please provide a valid UTR or Reference ID (min 4 characters).");
    if (!isExempted && !slipImage) return alert("Please upload the deposit slip, or declare an exemption.");
    if (isExempted && !exemptionCategory) return alert("You must select a reason for not uploading a slip.");
    if (isExempted && exemptionCategory === "Other" && otherExemptionText.trim().length < 4) {
      return alert("You must provide detailed remarks for 'Other' missing slips.");
    }

    setIsSubmitting(true);
    try {
      let finalSlipUrl = null;

      if (!isExempted && slipImage) {
        const fileExt = slipImage.name.split(".").pop();
        const fileName = `slip-${partner.id}-${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("deposit-slips")
          .upload(fileName, slipImage);

        if (uploadError) throw new Error("Image upload failed: " + uploadError.message);

        const { data: publicUrlData } = supabase.storage
          .from("deposit-slips")
          .getPublicUrl(fileName);
          
        finalSlipUrl = publicUrlData.publicUrl;
      }

      const finalExemptionReason = isExempted 
        ? (exemptionCategory === "Other" ? `OTHER: ${otherExemptionText}` : exemptionCategory) 
        : null;

      const { error } = await supabase.from("partner_deposits").insert([{
        partner_id: partner.id,
        center_id: partner.center_id, 
        deposit_amount: amt,
        deposit_method: form.deposit_method,
        reference_no: form.reference_no,
        deposit_date: form.deposit_date,
        deposit_slip_url: finalSlipUrl,
        is_exempted: isExempted,
        exemption_reason: finalExemptionReason,
        status: "Pending" 
      }]);

      if (error) throw error;

      alert("✅ Deposit submitted securely to the Accounts department.");
      
      setForm({ 
        deposit_amount: "", 
        deposit_method: "UPI", 
        reference_no: "", 
        deposit_date: getLocalDateString(new Date()) 
      });
      setSlipImage(null);
      setImagePreview(null);
      setOcrRawAmount(null);
      setOcrRawRef(null);
      setOcrRawDate(null);
      setDetectedPlatform(null);
      setIsUserVerified(false);
      setIsExempted(false);
      setExemptionCategory("");
      setOtherExemptionText("");
      
      initializePortal();
    } catch (err: any) {
      alert("Error submitting deposit: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT / CORRECTION ENGINE ---
  const startEditing = (dep: any) => {
    setEditingId(dep.id);
    setEditForm({
      deposit_amount: dep.deposit_amount,
      reference_no: dep.reference_no,
      deposit_method: dep.deposit_method
    });
  };

  const handleEditSubmit = async (id: string) => {
    if (!confirm("Update this deposit record?")) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("partner_deposits").update({
        deposit_amount: parseFloat(editForm.deposit_amount),
        reference_no: editForm.reference_no,
        deposit_method: editForm.deposit_method
      }).eq("id", id);

      if (error) throw error;
      
      alert("✅ Deposit record corrected.");
      setEditingId(null);
      initializePortal();
    } catch (err: any) {
      alert("Error updating record: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMatch = (id: string) => {
    setMatchedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
    </div>
  );

  const userEnteredValue = parseFloat(form.deposit_amount) || 0;
  const companyUPI = companyBanks.length > 0 ? companyBanks[0].upi_id : "fastark@upi";
  const upiString = `upi://pay?pa=${companyUPI}&pn=Fast%20Ark&am=${userEnteredValue}&cu=INR&tn=RollingDeposit_${partner?.center_id}`;

  const numInputClass = "w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-blue-500 font-black text-slate-800 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-6 gap-4">
          <div>
            <Link href="/partner/dashboard" className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-block">
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">💳</span> Deposit of Sales
            </h1>
            <p className="text-slate-500 font-medium mt-1">Submit bank slips and cross-check your remittance history.</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg text-right shadow-sm">
            <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest">Active Center</p>
            <p className="font-black text-slate-900">{partner?.locations?.center_name}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* LEFT: SUBMISSION FORM */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sticky top-8">
            <h2 className="font-black text-lg text-slate-800 border-b border-slate-100 pb-3 mb-5">
              Record New Remittance
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-5">
              
              {/* SLIP FORMAT SELECTOR */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                  Receipt Format Preset
                </label>
                <select 
                  value={slipTypePreset} 
                  onChange={(e) => setSlipTypePreset(e.target.value)}
                  className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none focus:border-blue-500 font-bold text-xs bg-slate-50 text-slate-700"
                >
                  <option value="auto">⚡ Auto-Detect Receipt Format</option>
                  <option value="gpay">Google Pay (UPI)</option>
                  <option value="phonepe">PhonePe (UPI)</option>
                  <option value="paytm">Paytm (UPI)</option>
                  <option value="cash_slip">Bank Branch Cash Slip</option>
                  <option value="neft_imps">NEFT / RTGS / IMPS Receipt</option>
                </select>
              </div>

              {/* SLIP UPLOAD & EXEMPTION */}
              <div className="space-y-3 pt-1 border-t border-slate-100">
                <label className="flex items-center gap-3 cursor-pointer bg-slate-50 p-3 rounded border border-slate-200">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 accent-amber-600"
                    checked={isExempted} 
                    onChange={(e) => { 
                      setIsExempted(e.target.checked); 
                      setSlipImage(null); 
                      setImagePreview(null); 
                      setOcrRawAmount(null); 
                      setOcrRawRef(null);
                      setOcrRawDate(null);
                      setDetectedPlatform(null);
                      setIsUserVerified(false);
                      setExemptionCategory(""); 
                      setOtherExemptionText(""); 
                    }}
                  />
                  <span className="font-bold text-sm text-slate-700">No deposit slip available (Request Exemption)</span>
                </label>

                {!isExempted ? (
                  <div className="border-2 border-dashed border-slate-300 rounded-xl p-5 text-center bg-slate-50 relative transition-all hover:bg-slate-100">
                    <input 
                      type="file" 
                      accept="image/*,.pdf" 
                      onChange={handleImageUpload} 
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    {!imagePreview ? (
                      <div>
                        <div className="text-3xl mb-1">📸</div>
                        <p className="font-bold text-slate-700 text-sm">Upload Slip or Screenshot</p>
                        <p className="text-[11px] text-slate-500 mt-1">GPay, PhonePe, Paytm, or Bank Cash Receipt</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <img src={imagePreview} alt="Slip Preview" className="h-24 w-auto rounded border shadow-sm mb-2 relative z-20" />
                        <p className="text-[11px] font-bold text-blue-600 bg-blue-100 px-3 py-1 rounded-full">Tap to change image</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-top-2 bg-amber-50 p-4 rounded-xl border border-amber-200">
                    <label className="text-[9px] text-amber-600 font-black uppercase tracking-widest block mb-1">Reason for Missing Slip *</label>
                    <select 
                      required 
                      value={exemptionCategory} 
                      onChange={(e) => { setExemptionCategory(e.target.value); setOtherExemptionText(""); }} 
                      className="w-full bg-white border-2 border-amber-200 text-slate-800 font-bold text-sm rounded-lg p-2.5 outline-none focus:border-amber-500 mb-3"
                    >
                      <option value="" disabled>-- Select Reason --</option>
                      <option value="Missing">Missing / Lost Slip</option>
                      <option value="Not downloaded">Not Downloaded / App Error</option>
                      <option value="Other">Other (Specify Below)</option>
                    </select>

                    {exemptionCategory === "Other" && (
                      <div>
                        <label className="text-[9px] text-amber-600 font-black uppercase tracking-widest block mb-1">Detailed Reason *</label>
                        <input 
                          required 
                          type="text" 
                          placeholder="TYPE REASON HERE..." 
                          value={otherExemptionText} 
                          onChange={(e) => setOtherExemptionText(e.target.value.toUpperCase())} 
                          className="w-full bg-white border-2 border-amber-200 text-slate-800 font-black uppercase tracking-wider text-sm rounded-lg p-2.5 outline-none focus:border-amber-500" 
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* OCR PROGRESS / SCANNER STATUS */}
              {isScanning && !isExempted && (
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2 text-blue-700 font-bold text-xs uppercase tracking-wider">
                    <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    Scanning Document Locally ({scanProgress}%)
                  </div>
                  <div className="w-full bg-blue-200 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full transition-all duration-200" 
                      style={{ width: `${scanProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* OCR EXTRACTION SUMMARY & MANDATORY VERIFICATION GATE */}
              {!isScanning && !isExempted && slipImage && detectedPlatform && (
                <div className="bg-slate-900 text-white rounded-xl p-4 space-y-3 border-2 border-slate-800">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                      OCR Audit & Capture
                    </span>
                    <span className="text-[10px] font-black bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded border border-blue-700">
                      {detectedPlatform}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-800/80 p-2 rounded">
                      <p className="text-[9px] text-slate-400 uppercase">Scanned Amount</p>
                      <p className="font-bold text-green-400">
                        {ocrRawAmount ? `₹${ocrRawAmount.toLocaleString("en-IN")}` : "Not detected"}
                      </p>
                    </div>
                    <div className="bg-slate-800/80 p-2 rounded">
                      <p className="text-[9px] text-slate-400 uppercase">Scanned Date</p>
                      <p className="font-bold text-slate-200">
                        {ocrRawDate ? ocrRawDate : "Not detected"}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-800/80 p-2 rounded text-xs">
                    <p className="text-[9px] text-slate-400 uppercase">Scanned Reference / UTR</p>
                    <p className="font-bold text-slate-200 tracking-wider truncate">
                      {ocrRawRef ? ocrRawRef : "Not detected"}
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-400 italic">
                    ℹ️ Values are auto-filled below. You can edit any field if the OCR misread characters.
                  </p>

                  {/* MANDATORY VALIDATION CHECKBOX */}
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-blue-950/70 border border-blue-700/80 cursor-pointer hover:bg-blue-950 transition">
                    <input 
                      type="checkbox" 
                      required
                      checked={isUserVerified} 
                      onChange={(e) => setIsUserVerified(e.target.checked)}
                      className="w-5 h-5 accent-blue-500 mt-0.5 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-blue-200 leading-tight">
                      I have cross-checked the scanned amount, date, and UTR against the receipt.
                    </span>
                  </label>
                </div>
              )}

              {/* MANUAL EDIT / AUTO-FILLED INPUT FIELDS */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                  Deposit Amount (₹) *
                </label>
                <input 
                  required 
                  type="number" 
                  step="0.01" 
                  value={form.deposit_amount} 
                  onChange={(e) => setForm({ ...form, deposit_amount: e.target.value })} 
                  onWheel={(e) => (e.target as HTMLInputElement).blur()} 
                  className={numInputClass} 
                  placeholder="0.00"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                    Deposit Date *
                  </label>
                  <input 
                    required 
                    type="date" 
                    value={form.deposit_date} 
                    onChange={(e) => setForm({ ...form, deposit_date: e.target.value })} 
                    className="w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-blue-500 font-bold text-sm bg-white" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                    Deposit Method *
                  </label>
                  <select 
                    required 
                    value={form.deposit_method} 
                    onChange={(e) => setForm({ ...form, deposit_method: e.target.value })} 
                    className="w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-blue-500 font-bold text-sm bg-white"
                  >
                    <option value="UPI">UPI</option>
                    <option value="NEFT/RTGS">NEFT/RTGS</option>
                    <option value="IMPS">IMPS</option>
                    <option value="Cash Deposit">Bank Cash Deposit</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                  UTR / Reference / Txn ID *
                </label>
                <input 
                  required 
                  type="text" 
                  value={form.reference_no} 
                  onChange={(e) => setForm({ ...form, reference_no: e.target.value })} 
                  className="w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-blue-500 font-bold tracking-wider" 
                  placeholder="e.g. 12-digit UTR or Journal No" 
                />
              </div>

              {/* QR CODE GENERATOR */}
              {form.deposit_method === "UPI" && userEnteredValue > 0 && (
                <div className="bg-slate-900 rounded-xl p-6 text-center border-2 border-slate-800 shadow-inner flex flex-col items-center animate-in fade-in zoom-in duration-300 mt-2">
                  <p className="text-blue-400 font-black uppercase tracking-widest text-xs mb-3">Scan to Pay via UPI</p>
                  <div className="bg-white p-3 rounded-xl shadow-lg mb-3">
                    <QRCodeSVG value={upiString} size={150} level="M" />
                  </div>
                  <p className="text-white font-bold">Fast Ark Pvt Ltd</p>
                  <p className="text-slate-400 text-xs">
                    Amount: ₹{userEnteredValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}

              {/* SUBMIT BUTTON */}
              <button 
                type="submit" 
                disabled={isSubmitting || isScanning || (!isExempted && slipImage !== null && !isUserVerified)} 
                className="w-full bg-slate-900 hover:bg-blue-600 text-white font-black py-4 rounded-xl shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed tracking-widest uppercase text-sm"
              >
                {isSubmitting 
                  ? "Submitting to Ledger..." 
                  : !isExempted && slipImage && !isUserVerified 
                    ? "Check Verification Box Above" 
                    : "Submit to Ledger"}
              </button>
            </form>
          </div>

          {/* RIGHT: HISTORY & VALIDATION GRID */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
            <div className="p-5 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm">Deposit Scan Proof & Ledger</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1">Cross-check physical slips against digital entries.</p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-4 font-black text-center" title="Tick to self-validate against your physical records">Match ✅</th>
                    <th className="p-4 font-black">Date</th>
                    <th className="p-4 font-black text-right">Amount (₹)</th>
                    <th className="p-4 font-black">Method & Ref No</th>
                    <th className="p-4 font-black text-center">Scan Proof</th>
                    <th className="p-4 font-black text-center">Status</th>
                    <th className="p-4 font-black text-center">Correction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deposits.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400 font-bold">No remittance records found.</td>
                    </tr>
                  ) : (
                    deposits.map((dep) => {
                      const isEditing = editingId === dep.id;
                      const isMatched = matchedRows.has(dep.id);

                      return (
                        <tr key={dep.id} className={`transition ${isEditing ? "bg-amber-50/30" : isMatched ? "bg-green-50/50" : "hover:bg-slate-50"}`}>
                          
                          {/* 1. MATCH CHECKBOX */}
                          <td className="p-4 text-center border-r border-slate-100">
                            <input 
                              type="checkbox" 
                              checked={isMatched} 
                              onChange={() => toggleMatch(dep.id)} 
                              className="w-5 h-5 accent-green-600 cursor-pointer shadow-sm rounded"
                              title="Check this box if you have validated this entry in your bank book."
                            />
                          </td>
                          
                          {/* 2. DATE */}
                          <td className="p-4">
                            <p className={`font-bold ${isMatched ? "text-green-800" : "text-slate-900"}`}>
                              {dep.deposit_date ? new Date(dep.deposit_date).toLocaleDateString("en-IN") : new Date(dep.created_at).toLocaleDateString("en-IN")}
                            </p>
                          </td>
                          
                          {/* 3. AMOUNT */}
                          <td className="p-4 text-right">
                            {isEditing ? (
                              <input 
                                type="number" 
                                step="0.01" 
                                value={editForm.deposit_amount} 
                                onChange={(e) => setEditForm({ ...editForm, deposit_amount: e.target.value })} 
                                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                className="w-24 border border-amber-300 p-1.5 rounded outline-none font-black text-right text-sm bg-white" 
                              />
                            ) : (
                              <p className={`text-lg font-black ${dep.status === "Discrepancy" ? "text-slate-400 line-through" : "text-slate-800"}`}>
                                ₹{Number(dep.deposit_amount).toLocaleString("en-IN")}
                              </p>
                            )}
                          </td>

                          {/* 4. METHOD & REFERENCE */}
                          <td className="p-4">
                            {isEditing ? (
                              <div className="flex flex-col gap-1">
                                <select 
                                  value={editForm.deposit_method} 
                                  onChange={(e) => setEditForm({ ...editForm, deposit_method: e.target.value })} 
                                  className="border border-amber-300 p-1 rounded outline-none font-bold text-[10px] uppercase bg-white"
                                >
                                  <option value="UPI">UPI</option>
                                  <option value="NEFT/RTGS">NEFT/RTGS</option>
                                  <option value="IMPS">IMPS</option>
                                  <option value="Cash Deposit">Cash Deposit</option>
                                  <option value="Cheque">Cheque</option>
                                </select>
                                <input 
                                  type="text" 
                                  value={editForm.reference_no} 
                                  onChange={(e) => setEditForm({ ...editForm, reference_no: e.target.value })} 
                                  className="border border-amber-300 p-1.5 rounded outline-none font-bold text-xs bg-white" 
                                />
                              </div>
                            ) : (
                              <>
                                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{dep.deposit_method}</p>
                                <p className="text-xs font-bold text-slate-700 tracking-wider mt-0.5">{dep.reference_no}</p>
                              </>
                            )}
                          </td>

                          {/* 5. SCAN PROOF */}
                          <td className="p-4 text-center">
                            {dep.is_exempted ? (
                              <div className="flex flex-col items-center cursor-help" title={dep.exemption_reason}>
                                <span className="text-xl">⚠️</span>
                                <p className="text-[9px] text-amber-600 font-black uppercase mt-1">Exempted</p>
                              </div>
                            ) : dep.deposit_slip_url ? (
                              <a href={dep.deposit_slip_url} target="_blank" rel="noreferrer" className="inline-flex flex-col items-center hover:opacity-70 transition">
                                <span className="text-xl">📎</span>
                                <p className="text-[9px] text-blue-600 font-black uppercase mt-1">View Slip</p>
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-bold uppercase">N/A</span>
                            )}
                          </td>

                          {/* 6. STATUS */}
                          <td className="p-4 text-center">
                            <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                              dep.status === "Verified" ? "bg-green-100 text-green-700 border-green-200" : 
                              dep.status === "Discrepancy" ? "bg-red-100 text-red-700 border-red-200" : 
                              "bg-amber-100 text-amber-700 border-amber-200"
                            }`}>
                              {dep.status}
                            </span>
                            {dep.status === "Discrepancy" && dep.rejection_reason && (
                              <p className="text-[9px] text-red-600 font-bold mt-1 truncate max-w-[100px]" title={dep.rejection_reason}>
                                {dep.rejection_reason}
                              </p>
                            )}
                          </td>

                          {/* 7. ACTION (EDIT CORRECTION) */}
                          <td className="p-4 text-right">
                            {dep.status === "Pending" || dep.status === "Pending Verification" ? (
                              isEditing ? (
                                <div className="flex gap-1 justify-end">
                                  <button onClick={() => handleEditSubmit(dep.id)} disabled={isSubmitting} className="bg-green-500 hover:bg-green-600 text-white font-black px-2 py-1 rounded text-[10px] uppercase shadow-sm">Save</button>
                                  <button onClick={() => setEditingId(null)} className="bg-slate-300 hover:bg-slate-400 text-slate-800 font-black px-2 py-1 rounded text-[10px] uppercase shadow-sm">Cancel</button>
                                </div>
                              ) : (
                                <button onClick={() => startEditing(dep)} className="bg-white hover:bg-amber-50 text-amber-600 border border-amber-200 hover:border-amber-400 font-black px-3 py-1.5 rounded text-[10px] uppercase tracking-widest shadow-sm transition">
                                  ✏️ Edit
                                </button>
                              )
                            ) : (
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Locked</span>
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

        </div>
      </div>
    </div>
  );
}