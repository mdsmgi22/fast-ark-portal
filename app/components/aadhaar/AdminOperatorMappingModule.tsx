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
  // 4-Tier Cascade State for Direct Operator Role Flip & Center Mapping
  const [mapState, setMapState] = useState("ALL");
  const [mapHq, setMapHq] = useState("ALL");
  const [mapCenterId, setMapCenterId] = useState("");
  const [enableCenterAadhaar, setEnableCenterAadhaar] = useState(false);

  const [mappingForm, setMappingForm] = useState({
    partner_id: "",
    operator_id: "",
    station_id: "",
  });
  const [isSavingMapping, setIsSavingMapping] = useState(false);

  // Upgrade Queue Filter & Inline Edit State
  const [reqFilter, setReqFilter] = useState<"Pending" | "Approved" | "Rejected" | "ALL">("Pending");
  const [editingReqId, setEditingReqId] = useState<string | null>(null);
  const [reqEditForm, setReqEditForm] = useState({
    center_id: "",
    operator_id: "",
    station_id: "",
  });
  const [isProcessingReq, setIsProcessingReq] = useState(false);

  // 1. Cascading Options for Direct Bind Form
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

  const activeAadhaarOperators = useMemo(
    () => partners.filter((p) => p.role_aadhaar && p.aadhaar_operator_id && p.aadhaar_station_id),
    [partners]
  );

  // --- HANDLER 1: DIRECT CASCADING AADHAAR CENTER & OPERATOR BIND ---
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

    setIsSavingMapping(true);
    try {
      const targetPartner = partners.find((p) => p.id === mappingForm.partner_id);

      // Step A: Ensure the physical Location is enabled as an Aadhaar Center
      const { error: locErr } = await supabase
        .from("locations")
        .update({ role_aadhaar: true })
        .eq("id", parseInt(mapCenterId));
      if (locErr) throw locErr;

      // Step B: Bind the Partner to that Aadhaar Center + Activate role_aadhaar & UIDAI IDs
      const { error: partErr } = await supabase
        .from("active_partners")
        .update({
          center_id: parseInt(mapCenterId),
          role_aadhaar: true,
          aadhaar_operator_id: mappingForm.operator_id.trim().toUpperCase(),
          aadhaar_station_id: mappingForm.station_id.trim(),
        })
        .eq("id", mappingForm.partner_id);

      if (partErr) throw partErr;

      // Step C: If they had any pending upgrade request, mark it Approved
      await supabase
        .from("partner_upgrade_requests")
        .update({ status: "Approved" })
        .eq("partner_id", mappingForm.partner_id)
        .eq("status", "Pending");

      await supabase.from("partner_messages").insert([
        {
          partner_id: mappingForm.partner_id,
          subject: "🆔 Aadhaar Seva Kendra Role Activated",
          body: `Your profile has been mapped to Aadhaar Center [${selectedCenterObj?.center_code}] ${selectedCenterObj?.center_name} (Operator ID: ${mappingForm.operator_id.toUpperCase()} | Station ID: ${mappingForm.station_id}). Your Aadhaar Upload & QR Remittance dashboard is now unlocked.`,
        },
      ]);

      await supabase.from("staff_activity_logs").insert([
        {
          staff_id: staffUser?.id || "ADMIN",
          staff_email: staffUser?.email,
          action_type: "AADHAAR_ROLE_FLIP",
          module: "AADHAAR_HUB",
          target_id: mappingForm.partner_id,
          details: `Mapped Aadhaar Center [${selectedCenterObj?.center_code}] & Activated Aadhaar Role for ${targetPartner?.partner_name}. Op: ${mappingForm.operator_id.toUpperCase()}, Stn: ${mappingForm.station_id}`,
        },
      ]);

      alert(
        `✅ Aadhaar Center [${selectedCenterObj?.center_code}] enabled and Partner ${targetPartner?.partner_name} bound to Operator ID ${mappingForm.operator_id.toUpperCase()} & Station ${mappingForm.station_id}!`
      );
      setMappingForm({ partner_id: "", operator_id: "", station_id: "" });
      setEnableCenterAadhaar(false);
      onRefresh();
    } catch (err: any) {
      alert("Mapping Error: " + err.message);
    } finally {
      setIsSavingMapping(false);
    }
  };

  // --- HANDLER 2: APPROVE OR REJECT PARTNER UPGRADE REQUEST ---
  const startInspectingRequest = (req: any) => {
    setEditingReqId(req.id);
    setReqEditForm({
      center_id: (req.center_id || req.active_partners?.center_id || "").toString(),
      operator_id: req.requested_operator_id || "",
      station_id: req.requested_station_id || "",
    });
  };

  const handleUpgradeDecision = async (req: any, decision: "Approved" | "Rejected") => {
    let reason = "";
    const finalCenterId = editingReqId === req.id ? reqEditForm.center_id : (req.center_id || req.active_partners?.center_id)?.toString();
    const finalOpId = (editingReqId === req.id ? reqEditForm.operator_id : req.requested_operator_id || "").trim().toUpperCase();
    const finalStnId = (editingReqId === req.id ? reqEditForm.station_id : req.requested_station_id || "").trim();

    if (decision === "Rejected") {
      const input = prompt("Enter reason for rejecting this Aadhaar Upgrade request:");
      if (!input || input.trim().length < 4) return alert("A valid rejection reason is required.");
      reason = input.trim();
    } else {
      if (!finalCenterId) {
        return alert("Mandatory: You must assign an Aadhaar Center before approving this operator.");
      }
      if (!finalOpId || finalStnId.length !== 5) {
        return alert("Mandatory: Operator ID and 5-digit Station ID must be valid before approval.");
      }
      const targetLoc = locations.find((l) => l.id?.toString() === finalCenterId);
      if (
        !confirm(
          `Approve Aadhaar Upgrade for ${req.active_partners?.partner_name}?\n\n• Mapped Aadhaar Center: [${
            targetLoc?.center_code || "NO-CODE"
          }] ${targetLoc?.center_name}\n• Operator ID: ${finalOpId}\n• Station ID: ${finalStnId}\n\nThis will enable the Aadhaar Center and unlock the partner's upload dashboard.`
        )
      )
        return;
    }

    setIsProcessingReq(true);
    try {
      if (decision === "Approved") {
        // 1. Enable Aadhaar Role on the assigned Center
        const { error: locErr } = await supabase
          .from("locations")
          .update({ role_aadhaar: true })
          .eq("id", parseInt(finalCenterId));
        if (locErr) throw locErr;

        // 2. Bind Partner Role, Center, Operator ID, and Station ID
        const { error: partErr } = await supabase
          .from("active_partners")
          .update({
            center_id: parseInt(finalCenterId),
            role_aadhaar: true,
            aadhaar_operator_id: finalOpId,
            aadhaar_station_id: finalStnId,
          })
          .eq("id", req.partner_id);
        if (partErr) throw partErr;
      }

      const { error: reqErr } = await supabase
        .from("partner_upgrade_requests")
        .update({
          status: decision,
          reject_reason: reason || null,
          requested_operator_id: finalOpId,
          requested_station_id: finalStnId,
          center_id: finalCenterId ? parseInt(finalCenterId) : req.center_id,
        })
        .eq("id", req.id);
      if (reqErr) throw reqErr;

      await supabase.from("partner_messages").insert([
        {
          partner_id: req.partner_id,
          subject: `🆔 Aadhaar Upgrade Request ${decision}`,
          body:
            decision === "Approved"
              ? `Your Aadhaar Seva Kendra upgrade has been APPROVED! Operator ID: ${finalOpId} | Station ID: ${finalStnId}. Your Aadhaar Portal is now unlocked for daily CSV & HTML uploads.`
              : `Your Aadhaar upgrade request was declined. Reason: ${reason}. Please review and resubmit in Menu 6.`,
        },
      ]);

      await supabase.from("staff_activity_logs").insert([
        {
          staff_id: staffUser?.id || "ADMIN",
          staff_email: staffUser?.email,
          action_type: decision === "Approved" ? "APPROVAL" : "REJECTION",
          module: "AADHAAR_HUB",
          target_id: req.id,
          details: `${decision} Aadhaar Upgrade Request for ${req.active_partners?.partner_name} (Op: ${finalOpId}, Stn: ${finalStnId}).`,
        },
      ]);

      alert(`✅ Upgrade request marked as ${decision}.`);
      setEditingReqId(null);
      onRefresh();
    } catch (err: any) {
      alert("Error processing upgrade: " + err.message);
    } finally {
      setIsProcessingReq(false);
    }
  };

  // --- HANDLER 3: REVOKE AADHAAR ACCESS ---
  const handleRevokeAadhaarAccess = async (op: any) => {
    if (
      !confirm(
        `Revoke Aadhaar Seva Kendra access for ${op.partner_name} (Op: ${op.aadhaar_operator_id})? They will be locked out of the Aadhaar Upload dashboard immediately.`
      )
    )
      return;

    try {
      const { error } = await supabase
        .from("active_partners")
        .update({ role_aadhaar: false })
        .eq("id", op.id);
      if (error) throw error;

      await supabase.from("partner_messages").insert([
        {
          partner_id: op.id,
          subject: "⚠️ Aadhaar Dashboard Access Suspended",
          body: "Your Aadhaar Seva Kendra upload access has been revoked by Corporate Admin. Please contact your supervisor or submit an updated credential request.",
        },
      ]);

      alert("✅ Aadhaar access revoked for " + op.partner_name);
      onRefresh();
    } catch (err: any) {
      alert("Error revoking access: " + err.message);
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
              Step-by-Step Role &amp; Center Binding
            </span>
            <h3 className="font-black text-base text-slate-900 mt-0.5">
              Cascading Aadhaar Center &amp; Operator Bind
            </h3>
            <p className="text-xs font-bold text-slate-500 mt-1">
              Filter by State &rarr; Master HQ &rarr; Center [Code], enable the Aadhaar Center, and bind the partner&apos;s
              UIDAI Operator &amp; Station IDs.
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

            <button
              type="submit"
              disabled={isSavingMapping}
              className="w-full py-3.5 bg-slate-900 hover:bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow transition"
            >
              {isSavingMapping ? "Mapping Center & Binding IDs..." : "✅ Map Aadhaar Center & Approve Operator"}
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
                Partners cannot access the Aadhaar Upload dashboard until approved here.
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
                  <th className="p-3.5 text-center">Compliance PDF</th>
                  <th className="p-3.5 text-right">Approval Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleRequests.map((req) => {
                  const isEditing = editingReqId === req.id;
                  const locObj = locations.find(
                    (l) => l.id === (req.center_id || req.active_partners?.center_id)
                  );

                  return (
                    <tr key={req.id} className="hover:bg-slate-50 align-top">
                      <td className="p-3.5 font-bold">{formatToDDMMYYYY(req.created_at)}</td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">{req.active_partners?.partner_name}</p>
                        {isEditing ? (
                          <select
                            value={reqEditForm.center_id}
                            onChange={(e) => setReqEditForm({ ...reqEditForm, center_id: e.target.value })}
                            className="mt-1 border border-blue-300 rounded p-1 text-[10px] font-bold bg-blue-50"
                          >
                            <option value="" disabled>
                              -- Select Center --
                            </option>
                            {locations
                              .filter((l) => !l.is_master_node)
                              .map((l) => (
                                <option key={l.id} value={l.id}>
                                  [{l.center_code || "NO-CODE"}] {l.center_name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <div className="mt-0.5">
                            <span className="text-[10px] font-bold text-slate-600 block">
                              [{locObj?.center_code || "NO-CODE"}] {locObj?.center_name || "Unassigned"}
                            </span>
                            <span
                              className={`text-[9px] font-black uppercase ${
                                locObj?.role_aadhaar ? "text-emerald-600" : "text-amber-600"
                              }`}
                            >
                              {locObj?.role_aadhaar ? "🆔 Aadhaar Center ON" : "⚠️ Will Enable Center on Approval"}
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="p-3.5">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={reqEditForm.operator_id}
                              onChange={(e) =>
                                setReqEditForm({ ...reqEditForm, operator_id: e.target.value.toUpperCase() })
                              }
                              className="border border-amber-300 rounded p-1 text-[10px] font-black uppercase w-32 block"
                              placeholder="Operator ID"
                            />
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
                              className="border border-amber-300 rounded p-1 text-[10px] font-black w-24 block"
                              placeholder="5-Digit Stn"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="font-black text-blue-700">Op: {req.requested_operator_id}</p>
                            <p className="text-[10px] font-bold text-slate-600">
                              Stn: {req.requested_station_id} | NSEIT: {req.nseit_cert_no}
                            </p>
                          </>
                        )}
                      </td>

                      <td className="p-3.5 text-center">
                        <button
                          type="button"
                          onClick={() => onDownloadVaultFile(req.compliance_pdf_url, "application_documents")}
                          className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-3 py-1 rounded text-[10px] font-black uppercase"
                        >
                          📄 View PDF
                        </button>
                      </td>

                      <td className="p-3.5 text-right">
                        {req.status === "Pending" ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={isProcessingReq}
                                onClick={() => handleUpgradeDecision(req, "Approved")}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded text-[10px] font-black uppercase shadow-sm"
                              >
                                ✅ Approve &amp; Bind
                              </button>
                              <button
                                type="button"
                                disabled={isProcessingReq}
                                onClick={() => handleUpgradeDecision(req, "Rejected")}
                                className="bg-red-600 hover:bg-red-500 text-white px-2.5 py-1 rounded text-[10px] font-black uppercase shadow-sm"
                              >
                                Reject
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                isEditing ? setEditingReqId(null) : startInspectingRequest(req)
                              }
                              className="text-[9px] font-black uppercase text-blue-600 hover:underline"
                            >
                              {isEditing ? "Cancel Edit" : "✏️ Edit Center / IDs Before Approval"}
                            </button>
                          </div>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              req.status === "Approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {req.status}
                          </span>
                        )}
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

      {/* BOTTOM ROSTER: ACTIVE MAPPED AADHAAR CENTERS & OPERATORS */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
          <h3 className="font-black text-xs uppercase tracking-widest">
            Active Approved Aadhaar Operators &amp; Mapped Centers ({activeAadhaarOperators.length})
          </h3>
          <span className="text-[10px] font-bold text-emerald-400 uppercase">
            Authorized to Upload Daily &amp; Weekly Reports
          </span>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
              <tr>
                <th className="p-3.5">Mapped Aadhaar Center [Code]</th>
                <th className="p-3.5">State &amp; District</th>
                <th className="p-3.5">Approved Operator Name</th>
                <th className="p-3.5">UIDAI Operator ID</th>
                <th className="p-3.5">UIDAI Station ID</th>
                <th className="p-3.5 text-right">Access Control</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {activeAadhaarOperators.map((op) => (
                <tr key={op.id} className="hover:bg-slate-50">
                  <td className="p-3.5">
                    <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded font-black text-[10px] mr-2">
                      {op.locations?.center_code || "NO-CODE"}
                    </span>
                    <span className="font-black text-slate-900">{op.locations?.center_name}</span>
                  </td>
                  <td className="p-3.5 font-bold text-slate-600">
                    {op.locations?.dist}, {op.locations?.state}
                  </td>
                  <td className="p-3.5 font-black text-blue-700">{op.partner_name}</td>
                  <td className="p-3.5 font-black text-slate-900">{op.aadhaar_operator_id}</td>
                  <td className="p-3.5 font-black text-amber-700">{op.aadhaar_station_id}</td>
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
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-2.5 py-1 rounded text-[10px] font-black uppercase border border-slate-300"
                    >
                      ✏️ Edit IDs
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevokeAadhaarAccess(op)}
                      className="bg-red-50 hover:bg-red-100 text-red-700 px-2.5 py-1 rounded text-[10px] font-black uppercase border border-red-200"
                    >
                      🚫 Revoke Access
                    </button>
                  </td>
                </tr>
              ))}
              {activeAadhaarOperators.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400 font-bold">
                    No Aadhaar Operators have been mapped and approved yet. Use the form above to map your first Aadhaar Center and Operator.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}