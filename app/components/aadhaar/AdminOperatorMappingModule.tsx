"use client";

import React, { useState, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { formatToDDMMYYYY } from "../../lib/aadhaarEngine";

interface AdminOperatorMappingProps {
  locations: any[];
  partners: any[];
  upgradeRequests: any[];
  staffUser: any;
  onRefresh: () => void;
  onDownloadVaultFile: (path: string | null, bucket?: string) => void;
}

export default function AdminOperatorMappingModule({
  locations,
  partners,
  upgradeRequests,
  staffUser,
  onRefresh,
  onDownloadVaultFile,
}: AdminOperatorMappingProps) {
  const [mapState, setMapState] = useState("ALL");
  const [mapHq, setMapHq] = useState("ALL");
  const [mapCenterId, setMapCenterId] = useState("");
  const [enableCenterAadhaar, setEnableCenterAadhaar] = useState(false);
  const [confirmDirectBindCheck, setConfirmDirectBindCheck] = useState(false);

  const [mappingForm, setMappingForm] = useState({
    partner_id: "",
    operator_id: "",
    station_id: "",
    nseit_no: "",
  });
  const [isSavingMapping, setIsSavingMapping] = useState(false);

  // Roster Filter (All Mapped, Active Only, Revoked Only, or by Station ID)
  const [rosterStatusFilter, setRosterStatusFilter] = useState<"ALL" | "ACTIVE" | "REVOKED">("ALL");
  const [rosterStationFilter, setRosterStationFilter] = useState<string>("ALL");

  // Upgrade Queue Filter & Pre-Approval Inspection/Edit Modal State
  const [reqFilter, setReqFilter] = useState<"Pending" | "Approved" | "Rejected" | "ALL">("Pending");
  const [inspectingReq, setInspectingReq] = useState<any | null>(null);
  const [reqEditForm, setReqEditForm] = useState({
    center_id: "",
    operator_id: "",
    station_id: "",
    nseit_no: "",
  });
  const [inspectSignedPdfUrl, setInspectSignedPdfUrl] = useState<string | null>(null);
  const [confirmAdminApproveCheck, setConfirmAdminApproveCheck] = useState(false);
  const [isProcessingReq, setIsProcessingReq] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const uniqueStates = useMemo(
    () => Array.from(new Set(locations.map((l) => l.state).filter(Boolean))).sort(),
    [locations]
  );

  const hqOptions = useMemo(
    () =>
      locations.filter(
        (l) => l.is_master_node && (mapState === "ALL" || l.state === mapState)
      ),
    [locations, mapState]
  );

  const spokeCenters = useMemo(
    () =>
      locations.filter(
        (l) =>
          !l.is_master_node &&
          (mapState === "ALL" || l.state === mapState) &&
          (mapHq === "ALL" || l.parent_master_id?.toString() === mapHq)
      ),
    [locations, mapState, mapHq]
  );

  const selectedCenterObj = useMemo(
    () => locations.find((l) => l.id?.toString() === mapCenterId),
    [locations, mapCenterId]
  );

  const partnersForSelectedCenter = useMemo(() => {
    return partners.filter((p) => {
      const loc = p.locations;
      if (mapState !== "ALL" && loc?.state !== mapState) return false;
      if (mapHq !== "ALL" && loc?.parent_master_id?.toString() !== mapHq) return false;
      if (mapCenterId && p.center_id?.toString() !== mapCenterId && loc?.id?.toString() !== mapCenterId) {
        return false;
      }
      return true;
    });
  }, [partners, mapState, mapHq, mapCenterId]);

  // Includes BOTH Active AND Revoked Aadhaar Operators so Admin can click "Allow Access" anytime
  const allMappedAadhaarOperators = useMemo(
    () =>
      partners.filter(
        (p) => Boolean(p.role_aadhaar || p.aadhaar_operator_id || p.aadhaar_station_id)
      ),
    [partners]
  );

  const uniqueRosterStations = useMemo(
    () =>
      Array.from(
        new Set(allMappedAadhaarOperators.map((p) => p.aadhaar_station_id).filter(Boolean))
      ).sort(),
    [allMappedAadhaarOperators]
  );

  const filteredRosterOperators = useMemo(() => {
    return allMappedAadhaarOperators.filter((op) => {
      const isAllowed = Boolean(op.role_aadhaar && op.locations?.role_aadhaar);
      if (rosterStatusFilter === "ACTIVE" && !isAllowed) return false;
      if (rosterStatusFilter === "REVOKED" && isAllowed) return false;
      if (rosterStationFilter !== "ALL" && op.aadhaar_station_id !== rosterStationFilter) return false;
      return true;
    });
  }, [allMappedAadhaarOperators, rosterStatusFilter, rosterStationFilter]);

  const handleDirectDownloadPdf = async (path: string | null, fileNameLabel: string) => {
    if (!path) return alert("No compliance PDF attached to this record.");
    setIsDownloadingPdf(true);
    try {
      const { data, error } = await supabase.storage.from("application_documents").createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) throw error || new Error("Failed to generate download link.");

      const response = await fetch(data.signedUrl);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `FastArk_Aadhaar_Compliance_${fileNameLabel.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert("Download Error: " + err.message);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleDirectOperatorMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapCenterId) {
      return alert("Mandatory Step 1: Please select the Target Center [Center Code] first.");
    }
    if (!selectedCenterObj?.role_aadhaar && !enableCenterAadhaar) {
      return alert(
        `Center [${selectedCenterObj?.center_code || "NO-CODE"}] ${selectedCenterObj?.center_name} is not enabled as an Aadhaar Center yet. Please check the box to enable Aadhaar Center Role on this location first.`
      );
    }
    if (!mappingForm.partner_id || !mappingForm.operator_id.trim() || mappingForm.station_id.trim().length !== 5) {
      return alert("Please select a Partner and enter a valid UIDAI Operator ID and 5-digit Station ID.");
    }
    if (!confirmDirectBindCheck) {
      return alert(
        "Mandatory: Please check the Admin verification box confirming the Center Code, Operator ID, and Station ID before binding."
      );
    }

    setIsSavingMapping(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Authentication session expired.");

      const res = await fetch("/api/approve-aadhaar-upgrade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId: null,
          partnerId: mappingForm.partner_id,
          centerId: Number(mapCenterId),
          operatorId: mappingForm.operator_id.trim().toUpperCase(),
          stationId: mappingForm.station_id.trim(),
          nseitCertNo: mappingForm.nseit_no.trim().toUpperCase() || "DIRECT_ADMIN_BIND",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to bind Aadhaar Operator.");
      }

      alert(`✅ ${data.message}`);
      setMappingForm({ partner_id: "", operator_id: "", station_id: "", nseit_no: "" });
      setEnableCenterAadhaar(false);
      setConfirmDirectBindCheck(false);
      onRefresh();
    } catch (err: any) {
      alert("Mapping Error: " + err.message);
    } finally {
      setIsSavingMapping(false);
    }
  };

  const openInspectionModal = async (req: any) => {
    setInspectingReq(req);
    setConfirmAdminApproveCheck(false);
    setReqEditForm({
      center_id: (req.center_id || req.active_partners?.center_id || "").toString(),
      operator_id: req.requested_operator_id || "",
      station_id: req.requested_station_id || "",
      nseit_no: req.nseit_cert_no || "",
    });
    setInspectSignedPdfUrl(null);

    if (req.compliance_pdf_url) {
      const { data } = await supabase.storage
        .from("application_documents")
        .createSignedUrl(req.compliance_pdf_url, 3600);
      if (data?.signedUrl) setInspectSignedPdfUrl(data.signedUrl);
    }
  };

  const handleSavePreApprovalEditsOnly = async () => {
    if (!inspectingReq) return;
    if (!reqEditForm.center_id || !reqEditForm.operator_id.trim() || reqEditForm.station_id.trim().length !== 5) {
      return alert("Please ensure Center, Operator ID, and 5-digit Station ID are valid before saving edits.");
    }

    setIsProcessingReq(true);
    try {
      const { error } = await supabase
        .from("partner_upgrade_requests")
        .update({
          center_id: parseInt(reqEditForm.center_id),
          requested_operator_id: reqEditForm.operator_id.trim().toUpperCase(),
          requested_station_id: reqEditForm.station_id.trim(),
          nseit_cert_no: reqEditForm.nseit_no.trim().toUpperCase(),
        })
        .eq("id", inspectingReq.id);

      if (error) throw error;
      alert("✅ Pre-approval corrections saved to the request record.");
      onRefresh();
    } catch (err: any) {
      alert("Error saving corrections: " + err.message);
    } finally {
      setIsProcessingReq(false);
    }
  };

  const handleUpgradeDecision = async (req: any, decision: "Approved" | "Rejected") => {
    const finalCenterId = reqEditForm.center_id || (req.center_id || req.active_partners?.center_id)?.toString();
    const finalOpId = (reqEditForm.operator_id || req.requested_operator_id || "").trim().toUpperCase();
    const finalStnId = (reqEditForm.station_id || req.requested_station_id || "").trim();
    const finalNseit = (reqEditForm.nseit_no || req.nseit_cert_no || "").trim().toUpperCase();

    if (decision === "Rejected") {
      const input = prompt("Enter reason for rejecting this Aadhaar Upgrade request:");
      if (!input || input.trim().length < 4) return alert("A valid rejection reason is required.");
      const reason = input.trim();

      setIsProcessingReq(true);
      try {
        const { error: reqErr } = await supabase
          .from("partner_upgrade_requests")
          .update({
            status: "Rejected",
            reject_reason: reason,
          })
          .eq("id", req.id);
        if (reqErr) throw reqErr;

        await supabase.from("partner_messages").insert([
          {
            partner_id: req.partner_id,
            subject: "🆔 Aadhaar Upgrade Request Rejected",
            body: `Your Aadhaar upgrade request was declined by Corporate Admin. Reason: ${reason}. Please review and resubmit in Menu 6.`,
          },
        ]);

        alert("✅ Upgrade request marked as Rejected.");
        setInspectingReq(null);
        onRefresh();
      } catch (err: any) {
        alert("Rejection Error: " + err.message);
      } finally {
        setIsProcessingReq(false);
      }
      return;
    }

    if (!finalCenterId) {
      return alert("Mandatory: You must assign an Aadhaar Center before approving this operator.");
    }
    if (!finalOpId || finalStnId.length !== 5) {
      return alert("Mandatory: Operator ID and 5-digit Station ID must be valid before approval.");
    }
    if (!confirmAdminApproveCheck) {
      return alert(
        "Mandatory: Please check the Admin verification box confirming that you have verified the compliance PDF and edited credentials."
      );
    }

    setIsProcessingReq(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Authentication session expired.");

      const res = await fetch("/api/approve-aadhaar-upgrade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId: req.id,
          partnerId: req.partner_id,
          centerId: Number(finalCenterId),
          operatorId: finalOpId,
          stationId: finalStnId,
          nseitCertNo: finalNseit,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Approval failed.");
      }

      alert(`✅ ${data.message}`);
      setInspectingReq(null);
      setConfirmAdminApproveCheck(false);
      onRefresh();
    } catch (err: any) {
      alert("Error approving upgrade: " + err.message);
    } finally {
      setIsProcessingReq(false);
    }
  };

  // --- HANDLER 3: REVOKE OR ALLOW (RESTORE) AADHAAR ACCESS ---
  const handleToggleAadhaarAccess = async (op: any, allowAccess: boolean) => {
    const actionLabel = allowAccess ? "ALLOW / RESTORE" : "REVOKE";
    if (
      !confirm(
        `Are you sure you want to ${actionLabel} Aadhaar Seva Kendra access for ${op.partner_name} (Op: ${
          op.aadhaar_operator_id || "N/A"
        } | Station: ${op.aadhaar_station_id || "N/A"})?`
      )
    )
      return;

    try {
      if (allowAccess) {
        if (!op.aadhaar_operator_id || !op.aadhaar_station_id) {
          return alert(
            "This partner does not have an Operator ID and 5-digit Station ID bound yet. Click 'Edit IDs' to assign them first."
          );
        }
        if (op.center_id) {
          await supabase.from("locations").update({ role_aadhaar: true }).eq("id", op.center_id);
        }
      }

      const { error } = await supabase
        .from("active_partners")
        .update({ role_aadhaar: allowAccess })
        .eq("id", op.id);
      if (error) throw error;

      await Promise.all([
        supabase.from("partner_messages").insert([
          {
            partner_id: op.id,
            subject: allowAccess
              ? `✅ Aadhaar Dashboard Access Restored (Station ${op.aadhaar_station_id})`
              : "⚠️ Aadhaar Dashboard Access Revoked",
            body: allowAccess
              ? `Your Aadhaar Seva Kendra access (Operator ID: ${op.aadhaar_operator_id} | Station ID: ${op.aadhaar_station_id}) has been restored by Corporate Admin. You may now upload daily and weekly reports.`
              : "Your Aadhaar Seva Kendra upload access has been revoked by Corporate Admin. Please contact your supervisor.",
          },
        ]),
        supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser?.id || "ADMIN",
            staff_email: staffUser?.email,
            action_type: allowAccess ? "AADHAAR_ALLOW" : "AADHAAR_REVOKE",
            module: "AADHAAR_HUB",
            target_id: op.id,
            details: `${allowAccess ? "Restored" : "Revoked"} Aadhaar access for ${op.partner_name} (Op: ${
              op.aadhaar_operator_id
            }, Stn: ${op.aadhaar_station_id}).`,
          },
        ]),
      ]);

      alert(`✅ Aadhaar access ${allowAccess ? "ALLOWED / RESTORED" : "REVOKED"} for ${op.partner_name}.`);
      onRefresh();
    } catch (err: any) {
      alert("Error updating access: " + err.message);
    }
  };

  const visibleRequests = upgradeRequests.filter((r) => reqFilter === "ALL" || r.status === reqFilter);

  return (
    <div className="space-y-8 animate-in fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (5 COLS): CASCADING AADHAAR CENTER & OPERATOR BIND */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600">
              Multi-Operator per Station Supported
            </span>
            <h3 className="font-black text-base text-slate-900 mt-0.5">
              Cascading Aadhaar Center &amp; Operator Bind
            </h3>
            <p className="text-xs font-bold text-slate-500 mt-1">
              Multiple operators can be bound to the same 5-digit Station ID. Filter by State &rarr; Master HQ &rarr;
              Center [Code] to bind and send confirmation email.
            </p>
          </div>

          <form onSubmit={handleDirectOperatorMap} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">1. Filter State</label>
                <select
                  value={mapState}
                  onChange={(e) => {
                    setMapState(e.target.value);
                    setMapHq("ALL");
                    setMapCenterId("");
                    setMappingForm({ ...mappingForm, partner_id: "" });
                  }}
                  className="w-full border p-2 rounded-lg font-bold bg-white"
                >
                  <option value="ALL">All States</option>
                  {uniqueStates.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">2. Filter Master HQ</label>
                <select
                  value={mapHq}
                  onChange={(e) => {
                    setMapHq(e.target.value);
                    setMapCenterId("");
                    setMappingForm({ ...mappingForm, partner_id: "" });
                  }}
                  className="w-full border p-2 rounded-lg font-bold bg-white"
                >
                  <option value="ALL">All Master HQs</option>
                  {hqOptions.map((hq) => (
                    <option key={hq.id} value={hq.id}>
                      {hq.center_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-[9px] font-black uppercase text-blue-700 mb-1">
                  3. Select Target Center [Center Code] *
                </label>
                <select
                  required
                  value={mapCenterId}
                  onChange={(e) => {
                    setMapCenterId(e.target.value);
                    setEnableCenterAadhaar(false);
                    setMappingForm({ ...mappingForm, partner_id: "" });
                  }}
                  className="w-full border-2 border-blue-200 p-2.5 rounded-lg font-black bg-white text-slate-900"
                >
                  <option value="" disabled>
                    -- Select Spoke Center ({spokeCenters.length} Available) --
                  </option>
                  {spokeCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.center_code || "NO-CODE"}] {c.center_name} —{" "}
                      {c.role_aadhaar ? "🆔 Aadhaar Enabled" : "⚠️ Aadhaar OFF"}
                    </option>
                  ))}
                </select>
              </div>

              {selectedCenterObj && !selectedCenterObj.role_aadhaar && (
                <div className="col-span-2 bg-amber-50 border border-amber-300 p-3 rounded-lg">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={enableCenterAadhaar}
                      onChange={(e) => setEnableCenterAadhaar(e.target.checked)}
                      className="w-4 h-4 accent-amber-600 mt-0.5"
                    />
                    <span className="text-[11px] font-black text-amber-950 leading-tight">
                      Enable Aadhaar Seva Kendra Role on [{selectedCenterObj.center_code || "NO-CODE"}]{" "}
                      {selectedCenterObj.center_name} so reports can be tracked for this location.
                    </span>
                  </label>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                4. Select Partner / Field Associate ({partnersForSelectedCenter.length}) *
              </label>
              <select
                required
                value={mappingForm.partner_id}
                onChange={(e) => {
                  const p = partners.find((x) => x.id === e.target.value);
                  if (p && !mapCenterId && p.center_id) {
                    setMapCenterId(p.center_id.toString());
                  }
                  setMappingForm({
                    partner_id: e.target.value,
                    operator_id: p?.aadhaar_operator_id || "",
                    station_id: p?.aadhaar_station_id || "",
                    nseit_no: "",
                  });
                }}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold bg-slate-50"
              >
                <option value="" disabled>
                  -- Choose Partner to Bind --
                </option>
                {partnersForSelectedCenter.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partner_name} ({p.role}) — [{p.locations?.center_code || "NO-CODE"}]
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                  5. UIDAI Operator ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., MYS_FAAFREEN"
                  value={mappingForm.operator_id}
                  onChange={(e) => setMappingForm({ ...mappingForm, operator_id: e.target.value.toUpperCase() })}
                  className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black uppercase"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                  6. Station ID (5 Digits) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={5}
                  placeholder="e.g., 21505"
                  value={mappingForm.station_id}
                  onChange={(e) =>
                    setMappingForm({ ...mappingForm, station_id: e.target.value.replace(/\D/g, "") })
                  }
                  className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black"
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-50 border border-blue-200 cursor-pointer">
              <input
                type="checkbox"
                required
                checked={confirmDirectBindCheck}
                onChange={(e) => setConfirmDirectBindCheck(e.target.checked)}
                className="w-4 h-4 accent-blue-600 mt-0.5 shrink-0"
              />
              <span className="text-[11px] font-bold text-blue-950 leading-tight">
                I have verified the Aadhaar Center Code, UIDAI Operator ID, and 5-digit Station ID for this associate.
              </span>
            </label>

            <button
              type="submit"
              disabled={isSavingMapping || !confirmDirectBindCheck}
              className="w-full py-3.5 bg-slate-900 hover:bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow disabled:opacity-40 transition"
            >
              {isSavingMapping ? "Binding & Sending Email..." : "✅ Map Center, Approve & Send Email"}
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN (7 COLS): PARTNER UPGRADE REQUEST APPROVAL QUEUE */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-900 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="font-black text-xs uppercase tracking-widest text-amber-400">
                Partner Aadhaar Upgrade Approval Queue ({visibleRequests.length})
              </h3>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                Inspect &amp; download the merged PDF, edit any typos if needed, tick verification, and approve.
              </p>
            </div>
            <div className="flex bg-slate-800 p-1 rounded-lg text-[10px] font-black uppercase">
              {(["Pending", "Approved", "Rejected", "ALL"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setReqFilter(st)}
                  className={`px-2.5 py-1 rounded transition ${
                    reqFilter === st ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[540px]">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                <tr>
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5">Partner &amp; Aadhaar Center</th>
                  <th className="p-3.5">Requested IDs</th>
                  <th className="p-3.5 text-center">Merged Compliance PDF</th>
                  <th className="p-3.5 text-right">Inspect / Edit &amp; Approve</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleRequests.map((req) => {
                  const locObj = locations.find(
                    (l) => l.id === (req.center_id || req.active_partners?.center_id)
                  );

                  return (
                    <tr key={req.id} className="hover:bg-slate-50 align-middle">
                      <td className="p-3.5 font-bold">{formatToDDMMYYYY(req.created_at)}</td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">{req.active_partners?.partner_name}</p>
                        <span className="text-[10px] font-bold text-slate-600 block">
                          [{locObj?.center_code || "NO-CODE"}] {locObj?.center_name || "Unassigned"}
                        </span>
                      </td>

                      <td className="p-3.5">
                        <p className="font-black text-blue-700">Op: {req.requested_operator_id}</p>
                        <p className="text-[10px] font-bold text-slate-600">
                          Stn: {req.requested_station_id} | NSEIT: {req.nseit_cert_no}
                        </p>
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="flex justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onDownloadVaultFile(req.compliance_pdf_url, "application_documents")}
                            className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase"
                          >
                            👁️ View
                          </button>
                          <button
                            type="button"
                            disabled={isDownloadingPdf}
                            onClick={() =>
                              handleDirectDownloadPdf(
                                req.compliance_pdf_url,
                                `${req.active_partners?.partner_name || "Partner"}_${req.requested_station_id}`
                              )
                            }
                            className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase"
                          >
                            📥 Download
                          </button>
                        </div>
                      </td>

                      <td className="p-3.5 text-right">
                        <div className="flex justify-end items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              req.status === "Approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : req.status === "Rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {req.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => openInspectionModal(req)}
                            className="bg-slate-900 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase shadow-sm transition"
                          >
                            {req.status === "Pending" ? "🔍 Edit & Approve" : "🔍 View / Re-Edit"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleRequests.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-slate-400 font-bold">
                      No {reqFilter === "ALL" ? "" : reqFilter.toLowerCase()} upgrade requests found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* BOTTOM ROSTER: MAPPED AADHAAR CENTERS & OPERATORS (WITH ALLOW / REVOKE TOGGLE & STATION FILTER) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-900 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="font-black text-xs uppercase tracking-widest">
              Mapped Aadhaar Operators &amp; Station ID Roster ({filteredRosterOperators.length})
            </h3>
            <p className="text-[10px] text-slate-400 font-bold mt-0.5">
              Multiple operators can work on a single Station ID. Toggle Allow or Revoke access anytime.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={rosterStationFilter}
              onChange={(e) => setRosterStationFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-amber-400 font-black text-[10px] uppercase px-2.5 py-1.5 rounded-lg outline-none"
            >
              <option value="ALL">All Station IDs ({uniqueRosterStations.length})</option>
              {uniqueRosterStations.map((stn) => (
                <option key={stn} value={stn}>
                  Station ID: {stn}
                </option>
              ))}
            </select>

            <div className="flex bg-slate-800 p-1 rounded-lg text-[10px] font-black uppercase">
              {(["ALL", "ACTIVE", "REVOKED"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setRosterStatusFilter(st)}
                  className={`px-2.5 py-1 rounded transition ${
                    rosterStatusFilter === st ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
              <tr>
                <th className="p-3.5">Mapped Aadhaar Center [Code]</th>
                <th className="p-3.5">Operator Name</th>
                <th className="p-3.5">UIDAI Operator ID</th>
                <th className="p-3.5">UIDAI Station ID</th>
                <th className="p-3.5 text-center">Portal Status</th>
                <th className="p-3.5 text-right">Allow / Revoke Control</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredRosterOperators.map((op) => {
                const isAllowed = Boolean(op.role_aadhaar && op.locations?.role_aadhaar);
                const operatorsOnSameStation = allMappedAadhaarOperators.filter(
                  (x) => x.aadhaar_station_id && x.aadhaar_station_id === op.aadhaar_station_id
                ).length;

                return (
                  <tr key={op.id} className={`hover:bg-slate-50 ${!isAllowed ? "bg-red-50/40" : ""}`}>
                    <td className="p-3.5">
                      <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded font-black text-[10px] mr-2">
                        {op.locations?.center_code || "NO-CODE"}
                      </span>
                      <span className="font-black text-slate-900">{op.locations?.center_name}</span>
                      <span className="text-[10px] text-slate-500 font-bold block mt-0.5">
                        {op.locations?.dist}, {op.locations?.state}
                      </span>
                    </td>
                    <td className="p-3.5 font-black text-blue-700">{op.partner_name}</td>
                    <td className="p-3.5 font-black text-slate-900">{op.aadhaar_operator_id || "UNMAPPED"}</td>
                    <td className="p-3.5">
                      <span className="font-black text-amber-700">{op.aadhaar_station_id || "UNMAPPED"}</span>
                      {operatorsOnSameStation > 1 && (
                        <span className="ml-2 bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded text-[9px] font-black uppercase">
                          {operatorsOnSameStation} Ops on Station
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-center">
                      {isAllowed ? (
                        <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded text-[9px] font-black uppercase">
                          🟢 Active (Allowed)
                        </span>
                      ) : (
                        <span className="bg-red-100 text-red-800 border border-red-200 px-2.5 py-1 rounded text-[9px] font-black uppercase">
                          🔴 Revoked (Blocked)
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMapState(op.locations?.state || "ALL");
                          setMapHq(op.locations?.parent_master_id?.toString() || "ALL");
                          setMapCenterId(op.center_id?.toString() || "");
                          setMappingForm({
                            partner_id: op.id,
                            operator_id: op.aadhaar_operator_id || "",
                            station_id: op.aadhaar_station_id || "",
                            nseit_no: "",
                          });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-2.5 py-1 rounded text-[10px] font-black uppercase border border-slate-300"
                      >
                        ✏️ Edit IDs
                      </button>

                      {isAllowed ? (
                        <button
                          type="button"
                          onClick={() => handleToggleAadhaarAccess(op, false)}
                          className="bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1 rounded text-[10px] font-black uppercase border border-red-200 shadow-sm"
                        >
                          🚫 Revoke Access
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleAadhaarAccess(op, true)}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded text-[10px] font-black uppercase shadow-sm"
                        >
                          ✅ Allow Access
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredRosterOperators.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400 font-bold">
                    No Aadhaar Operators match the selected status/station filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PRE-APPROVAL INSPECTION, EDIT, PDF VIEW/DOWNLOAD & VERIFY MODAL */}
      {inspectingReq && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl my-8 overflow-hidden animate-in zoom-in-95">
            <div className="p-5 bg-slate-900 text-white flex justify-between items-center border-b-4 border-amber-500">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 block">
                  Pre-Approval Verification &amp; Correction Console
                </span>
                <h3 className="font-black text-lg mt-0.5">
                  {inspectingReq.active_partners?.partner_name} ({inspectingReq.active_partners?.email})
                </h3>
              </div>
              <button
                onClick={() => setInspectingReq(null)}
                className="text-2xl font-black text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-5 space-y-4 text-xs">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 border-b pb-2">
                    1. Verify or Edit Credentials Before Approval
                  </p>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      Target Aadhaar Center [Center Code] *
                    </label>
                    <select
                      value={reqEditForm.center_id}
                      onChange={(e) => setReqEditForm({ ...reqEditForm, center_id: e.target.value })}
                      className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black bg-white"
                    >
                      <option value="" disabled>
                        -- Select Aadhaar Center --
                      </option>
                      {locations
                        .filter((l) => !l.is_master_node)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            [{l.center_code || "NO-CODE"}] {l.center_name} ({l.state})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      UIDAI Operator ID *
                    </label>
                    <input
                      type="text"
                      value={reqEditForm.operator_id}
                      onChange={(e) =>
                        setReqEditForm({ ...reqEditForm, operator_id: e.target.value.toUpperCase() })
                      }
                      className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black uppercase bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      UIDAI Station ID (5 Digits) *
                    </label>
                    <input
                      type="text"
                      maxLength={5}
                      value={reqEditForm.station_id}
                      onChange={(e) =>
                        setReqEditForm({
                          ...reqEditForm,
                          station_id: e.target.value.replace(/\D/g, ""),
                        })
                      }
                      className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      NSEIT Certificate No *
                    </label>
                    <input
                      type="text"
                      value={reqEditForm.nseit_no}
                      onChange={(e) =>
                        setReqEditForm({ ...reqEditForm, nseit_no: e.target.value.toUpperCase() })
                      }
                      className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black uppercase bg-white"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isProcessingReq}
                    onClick={handleSavePreApprovalEditsOnly}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-[10px] rounded-lg shadow transition"
                  >
                    💾 Save Corrections Without Approving Yet
                  </button>
                </div>

                <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-50 border-2 border-emerald-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmAdminApproveCheck}
                    onChange={(e) => setConfirmAdminApproveCheck(e.target.checked)}
                    className="w-5 h-5 accent-emerald-600 mt-0.5 shrink-0"
                  />
                  <span className="text-[11px] font-bold text-emerald-950 leading-relaxed">
                    <strong className="uppercase block text-[9px] tracking-widest text-emerald-700">
                      Mandatory Admin Verification *
                    </strong>
                    I have inspected the partner&apos;s merged compliance PDF and verified the Aadhaar Center Code,
                    Operator ID (<strong>{reqEditForm.operator_id}</strong>), and 5-digit Station ID (
                    <strong>{reqEditForm.station_id}</strong>).
                  </span>
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isProcessingReq || !confirmAdminApproveCheck}
                    onClick={() => handleUpgradeDecision(inspectingReq, "Approved")}
                    className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg disabled:opacity-40 transition"
                  >
                    {isProcessingReq ? "Processing..." : "✅ Approve, Bind & Send Email"}
                  </button>
                  <button
                    type="button"
                    disabled={isProcessingReq}
                    onClick={() => handleUpgradeDecision(inspectingReq, "Rejected")}
                    className="px-4 py-3.5 bg-red-600 hover:bg-red-500 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg transition"
                  >
                    Reject
                  </button>
                </div>
              </div>

              <div className="lg:col-span-7 bg-slate-900 rounded-xl overflow-hidden border border-slate-800 flex flex-col h-[540px]">
                <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex justify-between items-center text-white shrink-0">
                  <span className="text-xs font-black uppercase tracking-widest text-amber-400">
                    📄 Merged Compliance PDF Dossier
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onDownloadVaultFile(inspectingReq.compliance_pdf_url, "application_documents")
                      }
                      className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded text-[10px] font-black uppercase border border-slate-700"
                    >
                      👁️ Open Full Tab ↗
                    </button>
                    <button
                      type="button"
                      disabled={isDownloadingPdf}
                      onClick={() =>
                        handleDirectDownloadPdf(
                          inspectingReq.compliance_pdf_url,
                          `${inspectingReq.active_partners?.partner_name || "Partner"}_${reqEditForm.station_id}`
                        )
                      }
                      className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-[10px] font-black uppercase shadow"
                    >
                      {isDownloadingPdf ? "Downloading..." : "📥 Download Merged PDF"}
                    </button>
                  </div>
                </div>

                <div className="flex-1 bg-slate-800 flex items-center justify-center">
                  {inspectSignedPdfUrl ? (
                    <iframe
                      src={`${inspectSignedPdfUrl}#toolbar=0`}
                      className="w-full h-full bg-white"
                      title="Partner Merged Compliance PDF"
                    />
                  ) : (
                    <p className="text-slate-400 font-bold text-xs">Loading Merged Compliance PDF...</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}