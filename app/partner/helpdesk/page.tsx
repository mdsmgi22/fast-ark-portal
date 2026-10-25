// FILE PATH: ./app/partner/helpdesk/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

const BSNL_ISSUES = [
  "Technical issues",
  "Connectivity issues",
  "Portal down",
  "Application not working",
  "System not available / PC/Internet/Power/Back up/",
  "Other issues",
  "Sims not provided",
  "FTTH not available",
  "Toilet not available",
  "No water facilities",
];

const COMPANY_ISSUES = [
  "Technical issues",
  "Id activation",
  "Queries",
  "Salary not received",
  "Others",
];

export default function PartnerHelpdesk() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partner, setPartner] = useState<any>(null);

  // Ticket History State
  const [myTickets, setMyTickets] = useState<any[]>([]);

  // Form State
  const [category, setCategory] = useState<"BSNL" | "COMPANY">("BSNL");
  const [issueType, setIssueType] = useState("");
  const [complaintText, setComplaintText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [undertaking, setUndertaking] = useState(false);

  useEffect(() => {
    initializePortal();
  }, []);

  const initializePortal = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

      // Case-insensitive partner lookup with location metadata
      const { data: pData } = await supabase
        .from("active_partners")
        .select("id, center_id, locations(id, state, parent_master_id)")
        .ilike("email", (session.user.email || "").trim())
        .maybeSingle();

      if (!pData) throw new Error("Partner profile not found.");
      setPartner(pData);

      await fetchTicketHistory(pData.id);
    } catch (err: any) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTicketHistory = async (partnerId: string) => {
    const { data } = await supabase
      .from("complaints_log")
      .select("*")
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false });

    setMyTickets(data || []);
  };

  // =========================================================================
  // GUARDRAIL ENGINE: Validates Dates (IST), Duplicates, and Monthly Quotas
  // =========================================================================
  const istNow = new Date(new Date().getTime() + 330 * 60000);
  const todayDate = istNow.getUTCDate();
  const currentMonthStr = istNow.toISOString().substring(0, 7);

  const getTicketStats = (issue: string) => {
    const thisMonthTickets = myTickets.filter(
      (t) =>
        t.issue_type === issue &&
        String(t.created_at || "").startsWith(currentMonthStr)
    );

    const hasUnresolved = thisMonthTickets.some((t) => t.status !== "Resolved");
    return { count: thisMonthTickets.length, hasUnresolved };
  };

  const getQuotaLimit = (issue: string) => {
    if (
      [
        "Toilet not available",
        "No water facilities",
        "Salary not received",
      ].includes(issue)
    )
      return 1;
    return 3;
  };

  // Dynamic Validation Variables based on selected issue
  const stats = issueType
    ? getTicketStats(issueType)
    : { count: 0, hasUnresolved: false };
  const limit = issueType ? getQuotaLimit(issueType) : 3;

  const isDuplicateLocked = stats.hasUnresolved;
  const isQuotaLocked = stats.count >= limit;

  // =========================================================================
  // SEQUENTIAL FILE ENGINE & TEXT HANDLING
  // =========================================================================
  const handleFileAppend = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFile = e.target.files[0];

      // 5MB Size Limit
      if (newFile.size > 5 * 1024 * 1024) {
        return alert("File size must be under 5MB.");
      }

      if (files.length < 4) {
        setFiles((prev) => [...prev, newFile]);
      }
    }
    // Reset the input value so the same file could be selected again if removed
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Strictly enforces uppercase transformation at the keystroke level
    setComplaintText(e.target.value.toUpperCase());
  };

  // =========================================================================
  // SUBMISSION LOGIC
  // =========================================================================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner || isDuplicateLocked || isQuotaLocked) return;

    setSubmitting(true);
    try {
      const attachmentUrls: string[] = [];

      // Upload Evidence to Supabase Storage sequentially
      if (files.length > 0) {
        for (const file of files) {
          const fileExt = file.name.split(".").pop();
          const fileName = `${partner.id}/${Date.now()}_${Math.random()
            .toString(36)
            .substring(7)}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from("partner_complaint_evidence")
            .upload(fileName, file);

          if (uploadError)
            throw new Error("File upload failed: " + uploadError.message);

          const { data: publicUrlData } = supabase.storage
            .from("partner_complaint_evidence")
            .getPublicUrl(fileName);

          attachmentUrls.push(publicUrlData.publicUrl);
        }
      }

      const locData = partner.locations;
      const loc: any = Array.isArray(locData) ? locData[0] : locData;

      const ticketNumber = `TKT-${istNow
        .toISOString()
        .slice(2, 10)
        .replace(/-/g, "")}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

      // Prepare payload with strict structural mapping for back-office SLA & L1/L2/L3 filters
      const basePayload = {
        partner_id: partner.id,
        center_id: loc?.id || partner.center_id || null,
        hq_id: loc?.parent_master_id || null,
        state: loc?.state || null,
        category_type: category,
        issue_type: issueType,
        complaint_text: complaintText,
        attachments: attachmentUrls,
      };

      const { error: richErr } = await supabase.from("complaints_log").insert([
        {
          ...basePayload,
          ticket_number: ticketNumber,
          status: "Pending",
          current_level: 1,
          last_escalated_at: new Date().toISOString(),
        },
      ]);

      if (richErr && richErr.code === "42703") {
        const { error: fbErr } = await supabase
          .from("complaints_log")
          .insert([basePayload]);
        if (fbErr) throw fbErr;
      } else if (richErr) {
        throw richErr;
      }

      alert(
        `✅ Ticket (${ticketNumber}) successfully raised. Your supervisor has been notified.`
      );

      // Reset Form & Refresh History
      setIssueType("");
      setComplaintText("");
      setFiles([]);
      setUndertaking(false);
      fetchTicketHistory(partner.id);
    } catch (err: any) {
      alert("Submission Error: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <div className="p-20 text-center font-bold text-blue-600 animate-pulse">
        Loading Helpdesk...
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <div>
            <Link
              href="/partner/dashboard"
              className="text-blue-600 font-bold text-sm mb-1 hover:underline block"
            >
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900">
              Partner Helpdesk
            </h1>
            <p className="text-slate-500 font-medium">
              Log difficulties and track resolutions.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ======================= LEFT: TICKET FORM ======================= */}
          <div className="bg-white p-6 md:p-8 rounded-xl border border-slate-200 shadow-sm h-fit">
            <h2 className="font-black text-xl text-slate-800 mb-6 flex items-center gap-2">
              <span className="text-2xl">🎫</span> Raise a New Ticket
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* CATEGORY SELECTOR */}
              <div className="flex gap-4 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setCategory("BSNL");
                    setIssueType("");
                  }}
                  className={`flex-1 py-3 text-sm font-black uppercase tracking-widest rounded-md transition ${
                    category === "BSNL"
                      ? "bg-blue-600 text-white shadow"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  1. BSNL Queries
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCategory("COMPANY");
                    setIssueType("");
                  }}
                  className={`flex-1 py-3 text-sm font-black uppercase tracking-widest rounded-md transition ${
                    category === "COMPANY"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  2. Company Queries
                </button>
              </div>

              {/* ISSUE TYPE DROPDOWN */}
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                  Select Issue Type *
                </label>
                <select
                  required
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  className="w-full border-2 border-slate-300 p-3 rounded-lg font-bold text-slate-800 outline-none focus:border-blue-500 transition"
                >
                  <option value="" disabled>
                    -- Select specific difficulty --
                  </option>
                  {(category === "BSNL" ? BSNL_ISSUES : COMPANY_ISSUES).map(
                    (issue) => {
                      // Salary Date Guardrail Engine
                      if (issue === "Salary not received" && todayDate <= 10)
                        return null;
                      return (
                        <option key={issue} value={issue}>
                          {issue}
                        </option>
                      );
                    }
                  )}
                </select>

                {/* DYNAMIC GUARDRAIL ALERTS */}
                {issueType && isDuplicateLocked && (
                  <p className="text-red-600 font-bold text-xs mt-2 p-2 bg-red-50 rounded border border-red-200">
                    ⚠️ Locked: You already have an unresolved ticket for this
                    issue. Please wait for resolution.
                  </p>
                )}
                {issueType && !isDuplicateLocked && isQuotaLocked && (
                  <p className="text-amber-600 font-bold text-xs mt-2 p-2 bg-amber-50 rounded border border-amber-200">
                    ⚠️ Locked: Monthly limit ({limit}) reached for this
                    category. Contact management directly.
                  </p>
                )}
              </div>

              {/* UPPERCASE ENFORCED TEXT AREA */}
              <div
                className={
                  isDuplicateLocked || isQuotaLocked
                    ? "opacity-50 pointer-events-none"
                    : ""
                }
              >
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                  Detailed Remarks *{" "}
                  <span className="text-slate-400 font-normal normal-case">
                    (Max {category === "BSNL" ? 2000 : 500} letters)
                  </span>
                </label>
                <textarea
                  required
                  maxLength={category === "BSNL" ? 2000 : 500}
                  rows={5}
                  value={complaintText}
                  onChange={handleTextChange}
                  placeholder="DESCRIBE THE ISSUE IN DETAIL HERE..."
                  className="w-full border-2 border-slate-300 p-3 rounded-lg font-bold text-slate-800 outline-none focus:border-blue-500 transition resize-none placeholder:text-slate-300 uppercase"
                />
              </div>

              {/* SEQUENTIAL ATTACHMENT HANDLER */}
              <div
                className={
                  isDuplicateLocked || isQuotaLocked
                    ? "opacity-50 pointer-events-none"
                    : ""
                }
              >
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                  Evidence / Attachments (Max 4)
                </label>

                {/* List of currently selected files */}
                {files.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {files.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center bg-blue-50 border border-blue-200 p-3 rounded-lg text-xs font-bold text-blue-800 shadow-sm animate-in fade-in zoom-in-95"
                      >
                        <span className="truncate pr-4">📎 {file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeFile(idx)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 w-6 h-6 flex items-center justify-center rounded-full font-black text-lg transition"
                          title="Remove attachment"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* The Sequential "Add Attachment" Button */}
                {files.length < 4 && (
                  <div className="relative overflow-hidden inline-block w-full">
                    <button
                      type="button"
                      className="w-full bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 text-slate-600 font-black py-4 rounded-lg transition uppercase tracking-widest text-xs flex items-center justify-center gap-2 shadow-sm hover:shadow"
                    >
                      <span className="text-lg">➕</span> Add Attachment{" "}
                      {files.length > 0 ? `(${files.length}/4)` : ""}
                    </button>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileAppend}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                )}
                <p className="text-[10px] font-bold text-slate-400 mt-2">
                  Accepted formats: JPG, PNG, PDF (Max 5MB each)
                </p>
              </div>

              {/* LEGAL UNDERTAKING */}
              <div
                className={`bg-slate-100 p-4 border border-slate-200 rounded-lg flex items-start gap-3 ${
                  isDuplicateLocked || isQuotaLocked
                    ? "opacity-50 pointer-events-none"
                    : ""
                }`}
              >
                <input
                  type="checkbox"
                  id="undertaking"
                  required
                  checked={undertaking}
                  onChange={(e) => setUndertaking(e.target.checked)}
                  className="w-5 h-5 accent-blue-600 cursor-pointer mt-0.5 shrink-0"
                />
                <label
                  htmlFor="undertaking"
                  className="text-[10px] font-bold text-slate-600 cursor-pointer flex-1 leading-relaxed uppercase tracking-wider"
                >
                  <span className="text-slate-900 font-black block mb-0.5">
                    Mandatory Undertaking *
                  </span>
                  I hereby confirm that the information provided is accurate and
                  true. I understand that raising false, duplicate, or
                  misleading complaints violates operational policies.
                </label>
              </div>

              {/* SUBMIT BUTTON */}
              <button
                type="submit"
                disabled={
                  submitting ||
                  !issueType ||
                  isDuplicateLocked ||
                  isQuotaLocked ||
                  !undertaking
                }
                className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-black text-lg rounded-xl transition shadow-md disabled:bg-slate-300 disabled:text-slate-500 uppercase tracking-widest"
              >
                {submitting ? "Uploading Ticket..." : "Submit Ticket"}
              </button>
            </form>
          </div>

          {/* ======================= RIGHT: TICKET HISTORY ======================= */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[800px]">
            <div className="p-6 bg-slate-900 text-white border-b border-slate-800">
              <h2 className="font-black text-lg flex items-center gap-2 tracking-wide">
                <span>📋</span> My Ticket History
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-4">
              {myTickets.length === 0 ? (
                <div className="p-10 text-center text-slate-400 font-bold">
                  No tickets found.
                </div>
              ) : (
                myTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md transition relative"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="bg-slate-100 text-slate-600 text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-slate-200">
                          {ticket.ticket_number || "TICKET"}
                        </span>
                        <h3 className="font-black text-slate-800 mt-1">
                          {ticket.issue_type}
                        </h3>
                      </div>

                      {/* DYNAMIC PIPELINE STATUS BADGE */}
                      <span
                        className={`text-[10px] font-black px-2.5 py-1 rounded-sm uppercase tracking-widest shadow-sm ${
                          ticket.status === "Resolved"
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                            : ticket.status === "Escalated L3"
                            ? "bg-red-100 text-red-800 border border-red-200"
                            : ticket.status === "Escalated L2"
                            ? "bg-amber-100 text-amber-800 border border-amber-200"
                            : "bg-blue-100 text-blue-800 border border-blue-200"
                        }`}
                      >
                        {ticket.status || "Pending"}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-slate-600 bg-slate-50 p-3 rounded border border-slate-100 mb-3 italic">
                      &quot;{ticket.complaint_text}&quot;
                    </p>

                    <div className="flex justify-between items-end border-t border-slate-100 pt-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {new Date(ticket.created_at).toLocaleString("en-IN")}
                      </span>
                      {ticket.attachments?.length > 0 && (
                        <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                          📎 {ticket.attachments.length} files
                        </span>
                      )}
                    </div>

                    {/* RESOLUTION REMARKS RENDERER */}
                    {ticket.status === "Resolved" && (
                      <div className="mt-4 pt-4 border-t-2 border-emerald-100 animate-in fade-in">
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1 flex items-center gap-1">
                          <span>✅</span> Official Resolution
                        </p>
                        <p className="text-xs font-bold text-slate-800">
                          {ticket.l3_remarks ||
                            ticket.l2_remarks ||
                            ticket.l1_remarks ||
                            "Resolved by Management."}
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}