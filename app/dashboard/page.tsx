// FILE PATH: ./app/dashboard/partners/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { formatToDDMMYYYY } from "../lib/aadhaarEngine";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val ?? "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

type DossierTab = "kyc" | "mappings" | "vault" | "ledger" | "alert";

const ALERT_SUBJECT_PRESETS = [
  "Deposit pending notice",
  "Sales target not achieved",
  "SIM sales not happening",
  "Deposit slips missing",
  "Regular cash hold",
  "Aadhaar daily report missing",
  "Compliance documents pending",
  "Other (Custom Subject)",
];

export default function PartnersDirectory() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [staffUser, setStaffUser] = useState<any>(null);

  // Master Relational Streams
  const [partners, setPartners] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [ctopMappings, setCtopMappings] = useState<any[]>([]);
  const [virtualAccounts, setVirtualAccounts] = useState<any[]>([]);
  const [upiIds, setUpiIds] = useState<any[]>([]);
  const [upgradeRequests, setUpgradeRequests] = useState<any[]>([]);
  const [salesReports, setSalesReports] = useState<any[]>([]);
  const [aadhaarReports, setAadhaarReports] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [penalties, setPenalties] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  // 4-Tier Cascading Filters + Status + Search
  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fRole, setFRole] = useState("ALL");
  const [fStatus, setFStatus] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  // Compliance Vault Quick-Loader State
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);

  // Inline Aadhaar & Center Mapping Modal State (Preserved)
  const [mappingPartner, setMappingPartner] = useState<any | null>(null);
  const [mapForm, setMapForm] = useState({
    center_id: "",
    role_aadhaar: false,
    aadhaar_operator_id: "",
    aadhaar_station_id: "",
  });
  const [isSavingMap, setIsSavingMap] = useState(false);

  // 360° Partner Profile Inspector Modal State
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null);
  const [dossierTab, setDossierTab] = useState<DossierTab>("kyc");
  const [photoSignedUrl, setPhotoSignedUrl] = useState<string | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewPdfTitle, setPreviewPdfTitle] = useState<string>("");
  const [isLoadingVaultPreview, setIsLoadingVaultPreview] = useState(false);

  // Login-Safe Inline Profile Edit State (Inside Tab 1)
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileEditForm, setProfileEditForm] = useState({
    partner_name: "",
    mobile: "",
    alt_mobile: "",
    pan_number: "",
    father_name: "",
    qualification: "",
    gender: "",
    dob: "",
    address_1: "",
    address_2: "",
    pin_code: "",
    taluk: "",
    dist: "",
    state: "",
    role: "",
  });

  // Direct "Send Alert to Partner" Quick-Action State (Inside Tab 5)
  const [alertSubjectCategory, setAlertSubjectCategory] = useState("");
  const [alertCustomSubject, setAlertCustomSubject] = useState("");
  const [alertBody, setAlertBody] = useState("");
  const [isSendingAlert, setIsSendingAlert] = useState(false);

  useEffect(() => {
    fetchPartnersDatabase();
  }, []);

  const fetchPartnersDatabase = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data: staff } = await supabase
        .from("back_office_staff")
        .select("id, name, email, role, status")
        .ilike("email", (session.user.email || "").trim())
        .maybeSingle();

      if (staff) setStaffUser(staff);

      const [
        partRes,
        locRes,
        appRes,
        ctopRes,
        vaRes,
        upiRes,
        upgRes,
        salesRes,
        adhRes,
        depRes,
        penRes,
        msgRes,
        sessRes,
      ] = await Promise.all([
        supabase
          .from("active_partners")
          .select(
            `*, locations ( id, center_name, center_code, ba, oa, pin_code, taluk, dist, state, parent_master_id, role_aadhaar, role_ocsc, role_cm, role_partner )`
          )
          .order("joined_at", { ascending: false }),
        supabase
          .from("locations")
          .select("*")
          .order("center_name", { ascending: true }),
        supabase
          .from("pending_applications")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("agent_ctop_mappings")
          .select("*, master_ctop_accounts(master_ctop_no)"),
        supabase
          .from("virtual_accounts")
          .select("*, master_banks(bank_name, actual_account_no)"),
        supabase
          .from("upi_ids")
          .select("*, master_banks(bank_name, actual_account_no)"),
        supabase
          .from("partner_upgrade_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("daily_sales_reports")
          .select(
            "partner_id, cbp_landline_amt, cbp_gsm_amt, ctop_recharge_amt, sim_replacement_amt, sim_fancy_amt, sim_postpaid_amt, other_amt, frc_amt, mnp_amt, pb_cbp_amt, pb_ctop_amt, pb_frc_amt, pb_mnp_amt, pb_other_amt"
          ),
        supabase
          .from("aadhaar_daily_reports")
          .select("partner_id, total_packets_qty, total_cash_collected"),
        supabase
          .from("partner_deposits")
          .select(
            "partner_id, deposit_amount, status, deposit_stream, reference_no"
          )
          .neq("status", "Discrepancy"),
        supabase
          .from("aadhaar_penalty_logs")
          .select("partner_id, penalty_amount, is_settled, is_waived")
          .eq("is_settled", false),
        supabase
          .from("partner_messages")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("active_sessions").select("*"),
      ]);

      if (partRes.error) throw partRes.error;

      setPartners(partRes.data || []);
      setLocations(locRes.data || []);
      setApplications(appRes.data || []);
      setCtopMappings(ctopRes.data || []);
      setVirtualAccounts(vaRes.data || []);
      setUpiIds(upiRes.data || []);
      setUpgradeRequests(upgRes.data || []);
      setSalesReports(salesRes.data || []);
      setAadhaarReports(adhRes.data || []);
      setDeposits(depRes.data || []);
      setPenalties((penRes.data || []).filter((p: any) => !p.is_waived));
      setMessages(msgRes.data || []);
      setSessions(sessRes.data || []);
    } catch (error: any) {
      console.error("Error fetching partner database:", error.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // 360° RELATIONAL PROFILE ENRICHMENT ENGINE
  // =========================================================================
  const enrichedPartners = useMemo(() => {
    const isAadhaarDep = (d: any) =>
      d.deposit_stream === "AADHAAR" ||
      String(d.reference_no || "")
        .toUpperCase()
        .startsWith("AADHAAR_");

    return partners.map((p) => {
      const cleanEmail = String(p.email || "")
        .trim()
        .toLowerCase();

      // 1. Linked Onboarding Application (by application_id or case-insensitive email)
      const linkedApp =
        applications.find((a) => p.application_id && a.id === p.application_id) ||
        applications.find(
          (a) =>
            String(a.email || "")
              .trim()
              .toLowerCase() === cleanEmail
        ) ||
        null;

      // 2. Parent Master HQ Name
      const parentHq = locations.find(
        (l) => l.id === p.locations?.parent_master_id
      );

      // 3. Mapped Agent CTOPs, Virtual Accounts & UPI IDs
      const pCtops = ctopMappings.filter((c) => c.partner_id === p.id);
      const pVirtuals = virtualAccounts.filter(
        (v) => v.assigned_location_id === p.center_id
      );
      const pUpis = upiIds.filter(
        (u) => u.assigned_location_id === p.center_id
      );

      // 4. Latest Aadhaar Upgrade Dossier
      const latestUpgrade =
        upgradeRequests.find((u) => u.partner_id === p.id) || null;

      // 5. Financial Ledger Aggregation (BSNL+Paybull vs. Aadhaar)
      const pSales = salesReports.filter((s) => s.partner_id === p.id);
      const pAadhaar = aadhaarReports.filter((a) => a.partner_id === p.id);
      const pDeps = deposits.filter((d) => d.partner_id === p.id);
      const pPens = penalties.filter((pen) => pen.partner_id === p.id);

      let telecomGenerated = 0;
      pSales.forEach((s) => {
        telecomGenerated +=
          Number(s.cbp_landline_amt || 0) +
          Number(s.cbp_gsm_amt || 0) +
          Number(s.ctop_recharge_amt || 0) +
          Number(s.sim_replacement_amt || 0) +
          Number(s.sim_fancy_amt || 0) +
          Number(s.sim_postpaid_amt || 0) +
          Number(s.other_amt || 0) +
          Number(s.frc_amt || 0) +
          Number(s.mnp_amt || 0) +
          Number(s.pb_cbp_amt || 0) +
          Number(s.pb_ctop_amt || 0) +
          Number(s.pb_frc_amt || 0) +
          Number(s.pb_mnp_amt || 0) +
          Number(s.pb_other_amt || 0);
      });

      const telecomDeposited = pDeps
        .filter((d) => !isAadhaarDep(d))
        .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);
      const telecomDue = Math.max(0, telecomGenerated - telecomDeposited);

      const aadhaarGenerated = pAadhaar.reduce(
        (sum, a) => sum + Number(a.total_cash_collected || 0),
        0
      );
      const aadhaarPackets = pAadhaar.reduce(
        (sum, a) => sum + Number(a.total_packets_qty || 0),
        0
      );
      const aadhaarDeposited = pDeps
        .filter((d) => isAadhaarDep(d))
        .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);
      const aadhaarPenaltyDue = pPens.reduce(
        (sum, pen) => sum + Number(pen.penalty_amount || 0),
        0
      );
      const aadhaarDue =
        Math.max(0, aadhaarGenerated - aadhaarDeposited) + aadhaarPenaltyDue;

      const totalNetPayable = telecomDue + aadhaarDue;

      // 6. Session Telemetry & Inbox Alerts
      const activeSession =
        sessions.find((s) => s.user_id === p.auth_id) || null;
      const pMessages = messages.filter((m) => m.partner_id === p.id);
      const unreadAlertsCount = pMessages.filter((m) => !m.is_read).length;

      return {
        ...p,
        linkedApp,
        parentHqName: parentHq?.center_name || "Unassigned HQ",
        pCtops,
        pVirtuals,
        pUpis,
        latestUpgrade,
        telecomGenerated,
        telecomDeposited,
        telecomDue,
        aadhaarGenerated,
        aadhaarDeposited,
        aadhaarPenaltyDue,
        aadhaarDue,
        aadhaarPackets,
        totalNetPayable,
        activeSession,
        pMessages,
        unreadAlertsCount,
      };
    });
  }, [
    partners,
    applications,
    locations,
    ctopMappings,
    virtualAccounts,
    upiIds,
    upgradeRequests,
    salesReports,
    aadhaarReports,
    deposits,
    penalties,
    messages,
    sessions,
  ]);

  // Keep open modal in sync when database refreshes
  useEffect(() => {
    if (selectedProfile) {
      const updated = enrichedPartners.find(
        (p) => p.id === selectedProfile.id
      );
      if (updated) setSelectedProfile(updated);
    }
  }, [enrichedPartners]);

  // 4-Tier Cascading Options
  const uniqueStates = useMemo(
    () =>
      Array.from(
        new Set(locations.map((l) => l.state).filter(Boolean))
      ).sort(),
    [locations]
  );

  const hqOptions = useMemo(
    () =>
      locations.filter(
        (l) => l.is_master_node && (fState === "ALL" || l.state === fState)
      ),
    [locations, fState]
  );

  const centerOptions = useMemo(
    () =>
      locations.filter(
        (l) =>
          !l.is_master_node &&
          (fState === "ALL" || l.state === fState) &&
          (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
      ),
    [locations, fState, fHq]
  );

  const filteredPartners = useMemo(() => {
    return enrichedPartners.filter((p) => {
      const loc = p.locations;
      if (fState !== "ALL" && loc?.state !== fState) return false;
      if (fHq !== "ALL" && loc?.parent_master_id?.toString() !== fHq)
        return false;
      if (
        fCenter !== "ALL" &&
        loc?.id?.toString() !== fCenter &&
        p.center_id?.toString() !== fCenter
      )
        return false;

      if (fStatus !== "ALL" && p.status !== fStatus) return false;

      if (fRole !== "ALL") {
        const r = String(p.role || "").toUpperCase();
        if (fRole === "AADHAAR" && !p.role_aadhaar && !r.includes("AADHAAR"))
          return false;
        if (fRole === "OCSC" && !r.includes("OCSC")) return false;
        if (fRole === "CM" && !r.includes("CM")) return false;
        if (fRole === "PARTNER" && r !== "PARTNER" && !r.includes("IRCTC"))
          return false;
      }

      const q = searchTerm.toLowerCase().trim();
      if (!q) return true;
      return (
        p.partner_name?.toLowerCase().includes(q) ||
        p.mobile?.includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.linkedApp?.pan_number?.toLowerCase().includes(q) ||
        p.aadhaar_operator_id?.toLowerCase().includes(q) ||
        p.aadhaar_station_id?.includes(q) ||
        loc?.center_name?.toLowerCase().includes(q) ||
        loc?.center_code?.toLowerCase().includes(q)
      );
    });
  }, [enrichedPartners, fState, fHq, fCenter, fRole, fStatus, searchTerm]);

  // =========================================================================
  // ACTIONS: STATUS TOGGLE, CENTER/ID MAPPING, 360° DOSSIER, EDIT & ALERTS
  // =========================================================================
  const togglePartnerStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "Active" ? "Suspended" : "Active";
    if (
      newStatus === "Suspended" &&
      !confirm("Are you sure you want to suspend this partner's access?")
    ) {
      return;
    }

    try {
      const { error } = await supabase
        .from("active_partners")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) throw error;

      if (staffUser) {
        await supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser.id,
            staff_email: staffUser.email,
            action_type:
              newStatus === "Active" ? "PARTNER_RESTORED" : "PARTNER_SUSPENDED",
            module: "ONBOARDING",
            target_id: id,
            details: `Changed partner status to ${newStatus}.`,
          },
        ]);
      }

      fetchPartnersDatabase();
    } catch (error: any) {
      alert("Error updating status: " + error.message);
    }
  };

  const handleViewCompliance = async (
    partnerId: string,
    path: string | null
  ) => {
    if (!path) {
      return alert(
        "No compliance documents have been submitted by this partner yet."
      );
    }

    setLoadingDocId(partnerId);
    try {
      if (path.startsWith("http")) {
        window.open(path, "_blank");
        return;
      }

      const { data, error } = await supabase.storage
        .from("application_documents")
        .createSignedUrl(path, 3600);

      if (error || !data?.signedUrl) {
        throw (
          error || new Error("Failed to generate cryptographic signed URL.")
        );
      }

      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      alert("Error loading compliance document: " + err.message);
    } finally {
      setLoadingDocId(null);
    }
  };

  const openMappingModal = (p: any) => {
    setMappingPartner(p);
    setMapForm({
      center_id: p.center_id?.toString() || "",
      role_aadhaar: Boolean(
        p.role_aadhaar ||
          String(p.role || "")
            .toUpperCase()
            .includes("AADHAAR")
      ),
      aadhaar_operator_id: p.aadhaar_operator_id || "",
      aadhaar_station_id: p.aadhaar_station_id || "",
    });
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mappingPartner) return;
    if (
      mapForm.role_aadhaar &&
      (!mapForm.aadhaar_operator_id.trim() ||
        mapForm.aadhaar_station_id.trim().length !== 5)
    ) {
      return alert(
        "Please enter a valid UIDAI Operator ID and 5-digit Station ID when Aadhaar Role is enabled."
      );
    }

    setIsSavingMap(true);
    try {
      const { error } = await supabase
        .from("active_partners")
        .update({
          center_id: mapForm.center_id
            ? parseInt(mapForm.center_id, 10)
            : mappingPartner.center_id,
          role_aadhaar: mapForm.role_aadhaar,
          aadhaar_operator_id:
            mapForm.aadhaar_operator_id.trim().toUpperCase() || null,
          aadhaar_station_id: mapForm.aadhaar_station_id.trim() || null,
        })
        .eq("id", mappingPartner.id);

      if (error) throw error;

      if (mapForm.role_aadhaar && mapForm.center_id) {
        await supabase
          .from("locations")
          .update({ role_aadhaar: true })
          .eq("id", parseInt(mapForm.center_id, 10));
      }

      alert("✅ Partner Center & Aadhaar Station credentials updated!");
      setMappingPartner(null);
      fetchPartnersDatabase();
    } catch (err: any) {
      alert("Error saving mapping: " + err.message);
    } finally {
      setIsSavingMap(false);
    }
  };

  // --- OPEN 360° PARTNER PROFILE MODAL ---
  const open360ProfileModal = async (p: any, initialTab: DossierTab = "kyc") => {
    setSelectedProfile(p);
    setDossierTab(initialTab);
    setIsEditingProfile(false);
    setPhotoSignedUrl(null);
    setPreviewPdfUrl(null);
    setPreviewPdfTitle("");
    setAlertSubjectCategory("");
    setAlertCustomSubject("");
    setAlertBody("");

    const app = p.linkedApp;
    setProfileEditForm({
      partner_name: p.partner_name || app?.name || "",
      mobile: p.mobile || app?.mobile || "",
      alt_mobile: app?.alt_mobile || "",
      pan_number: app?.pan_number || "",
      father_name: app?.father_name || "",
      qualification: app?.qualification || "",
      gender: app?.gender || "",
      dob: app?.dob || "",
      address_1: app?.address_1 || "",
      address_2: app?.address_2 || "",
      pin_code: app?.pin_code || "",
      taluk: app?.taluk || "",
      dist: app?.dist || "",
      state: app?.state || "",
      role: p.role || app?.requested_role || "OCSC",
    });

    // Load Passport Photo Signed URL if available
    if (app?.photo_path) {
      const { data } = await supabase.storage
        .from("application_documents")
        .createSignedUrl(app.photo_path, 3600);
      if (data?.signedUrl) setPhotoSignedUrl(data.signedUrl);
    }
  };

  // --- LOGIN-SAFE INLINE PROFILE SAVE (DOES NOT TOUCH AUTH EMAIL/PASSWORD) ---
  const handleSaveInlineProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfile) return;

    const cleanName = profileEditForm.partner_name.trim().toUpperCase();
    const cleanMobile = profileEditForm.mobile.trim().replace(/\D/g, "");
    const cleanAltMobile = profileEditForm.alt_mobile
      .trim()
      .replace(/\D/g, "");
    const cleanPan = profileEditForm.pan_number.trim().toUpperCase();

    if (!cleanName) return alert("Partner Full Name cannot be empty.");
    if (cleanMobile.length !== 10)
      return alert("Primary Mobile Number must be 10 digits.");
    if (cleanAltMobile && cleanAltMobile.length !== 10)
      return alert("Alternative Mobile Number must be 10 digits.");
    if (cleanPan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
      return alert("Invalid PAN Card format (e.g., ABCDE1234F).");
    }

    setIsSavingProfile(true);
    try {
      // 1. Update active_partners (Email & auth_id are untouched so login is 100% unaffected)
      const { error: partErr } = await supabase
        .from("active_partners")
        .update({
          partner_name: cleanName,
          mobile: cleanMobile,
          role: profileEditForm.role,
        })
        .eq("id", selectedProfile.id);

      if (partErr) throw partErr;

      // 2. Synchronize demographic fields in pending_applications if linked record exists
      if (selectedProfile.linkedApp?.id) {
        const { error: appErr } = await supabase
          .from("pending_applications")
          .update({
            name: cleanName,
            mobile: cleanMobile,
            alt_mobile: cleanAltMobile || null,
            pan_number: cleanPan || null,
            father_name: profileEditForm.father_name.trim().toUpperCase(),
            qualification: profileEditForm.qualification,
            gender: profileEditForm.gender,
            dob: profileEditForm.dob || null,
            address_1: profileEditForm.address_1.trim().toUpperCase(),
            address_2: profileEditForm.address_2.trim().toUpperCase(),
            pin_code: profileEditForm.pin_code.trim(),
            taluk: profileEditForm.taluk.trim(),
            dist: profileEditForm.dist.trim(),
            state: profileEditForm.state.trim(),
            requested_role: profileEditForm.role,
          })
          .eq("id", selectedProfile.linkedApp.id);

        if (appErr) throw appErr;
      }

      if (staffUser) {
        await supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser.id,
            staff_email: staffUser.email,
            action_type: "PROFILE_UPDATE",
            module: "ONBOARDING",
            target_id: selectedProfile.id,
            details: `Updated 360° profile details for ${cleanName} (Mobile: ${cleanMobile}, Role: ${profileEditForm.role}). Login credentials preserved.`,
          },
        ]);
      }

      alert(
        "✅ Partner profile updated across directory & KYC records! Their login credentials and active session remain untouched."
      );
      setIsEditingProfile(false);
      await fetchPartnersDatabase();
    } catch (err: any) {
      alert("Error updating partner profile: " + err.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // --- UNIFIED DOCUMENT VAULT RESOLVER (PREVIEW OR NEW TAB) ---
  const resolveApplicationKycPath = async (p: any): Promise<string | null> => {
    const explicitPath = p.linkedApp?.role_metadata?.kyc_pdf_path;
    if (explicitPath) return explicitPath;

    const candidateName = p.linkedApp?.name || p.partner_name || "";
    const safeName = String(candidateName).replace(/[^a-zA-Z0-9]/g, "_");
    if (!safeName) return null;

    const expectedPrefix = `${safeName}_`;
    const { data: files } = await supabase.storage
      .from("application_documents")
      .list("", { search: safeName });

    const matchingPdfs = (files || [])
      .filter(
        (f) =>
          f.name.startsWith(expectedPrefix) &&
          f.name.toLowerCase().endsWith(".pdf")
      )
      .sort((a, b) => b.name.localeCompare(a.name));

    return matchingPdfs.length > 0 ? matchingPdfs[0].name : null;
  };

  const handleLoadVaultDocument = async (
    docType: "ONBOARDING_KYC" | "COMPLIANCE_DOSSIER" | "AADHAAR_UPGRADE",
    mode: "preview" | "open"
  ) => {
    if (!selectedProfile) return;
    setIsLoadingVaultPreview(true);
    try {
      let path: string | null = null;
      let label = "";

      if (docType === "ONBOARDING_KYC") {
        path = await resolveApplicationKycPath(selectedProfile);
        label = "1. Onboarding Application & KYC PDF";
      } else if (docType === "COMPLIANCE_DOSSIER") {
        path = selectedProfile.compliance_docs_url || null;
        label = "2. Operational Compliance Dossier PDF";
      } else if (docType === "AADHAAR_UPGRADE") {
        path = selectedProfile.latestUpgrade?.compliance_pdf_url || null;
        label = "3. Aadhaar Operator Upgrade Dossier PDF";
      }

      if (!path) {
        alert(`No document found on file for: ${label}`);
        return;
      }

      if (path.startsWith("http")) {
        if (mode === "open") window.open(path, "_blank");
        else {
          setPreviewPdfUrl(path);
          setPreviewPdfTitle(label);
        }
        return;
      }

      const { data, error } = await supabase.storage
        .from("application_documents")
        .createSignedUrl(path, 3600);

      if (error || !data?.signedUrl) {
        throw error || new Error("Could not generate signed URL.");
      }

      if (mode === "open") {
        window.open(data.signedUrl, "_blank");
      } else {
        setPreviewPdfUrl(data.signedUrl);
        setPreviewPdfTitle(label);
      }
    } catch (err: any) {
      alert("Vault Error: " + err.message);
    } finally {
      setIsLoadingVaultPreview(false);
    }
  };

  // --- DIRECT "SEND ALERT TO PARTNER" QUICK-ACTION (TAB 5) ---
  const handleSendDirectAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfile) return;
    if (!alertSubjectCategory)
      return alert("Please select a Notice Subject Heading.");
    if (
      alertSubjectCategory === "Other (Custom Subject)" &&
      alertCustomSubject.trim().length < 4
    ) {
      return alert("Please enter a valid custom subject line.");
    }
    if (alertBody.trim().length < 5) {
      return alert("Please enter a clear message body (min 5 characters).");
    }

    const finalSubject =
      alertSubjectCategory === "Other (Custom Subject)"
        ? alertCustomSubject.trim().toUpperCase()
        : alertSubjectCategory;

    setIsSendingAlert(true);
    try {
      const { error: msgErr } = await supabase.from("partner_messages").insert([
        {
          partner_id: selectedProfile.id,
          subject: `🚨 ALERT: ${finalSubject}`,
          body: alertBody.trim(),
        },
      ]);

      if (msgErr) throw msgErr;

      if (staffUser) {
        await supabase.from("staff_activity_logs").insert([
          {
            staff_id: staffUser.id,
            staff_email: staffUser.email,
            action_type: "DISPATCH_ALERT",
            module: "MESSAGES",
            target_id: selectedProfile.id,
            details: `Dispatched direct profile alert [${finalSubject}] to ${selectedProfile.partner_name}.`,
          },
        ]);
      }

      alert(
        `✅ Priority alert dispatched directly to ${selectedProfile.partner_name}'s inbox!`
      );
      setAlertSubjectCategory("");
      setAlertCustomSubject("");
      setAlertBody("");
      await fetchPartnersDatabase();
    } catch (err: any) {
      alert("Error sending alert: " + err.message);
    } finally {
      setIsSendingAlert(false);
    }
  };

  // --- 1-CLICK MASTER DATABASE CSV EXPORT ---
  const handleExportMasterDatabaseCSV = () => {
    if (filteredPartners.length === 0)
      return alert("No partners match the current filter to export.");

    const headers = [
      "Joined Date (DD/MM/YYYY)",
      "Account Status",
      "Partner Name",
      "Login Email",
      "Primary Mobile",
      "Alt Mobile",
      "PAN Number",
      "DOB",
      "Gender",
      "Qualification",
      "Guardian",
      "Operational Role",
      "Aadhaar Role Enabled",
      "UIDAI Operator ID",
      "UIDAI Station ID",
      "Center Code",
      "Center Name",
      "Master HQ",
      "Taluk",
      "District",
      "State",
      "PIN Code",
      "Mapped Agent CTOPs",
      "Terms Accepted",
      "Compliance PDF Uploaded",
      "BSNL+Paybull Due (INR)",
      "Aadhaar Due + Fines (INR)",
      "Total Net Payable (INR)",
    ];

    const rows = filteredPartners.map((p) => {
      const app = p.linkedApp;
      const loc = p.locations;
      const ctopList = (p.pCtops || [])
        .map((c: any) => c.agent_ctop_no)
        .join(" | ");

      return [
        sanitizeCSV(
          formatToDDMMYYYY(String(p.joined_at || "").split("T")[0])
        ),
        sanitizeCSV(p.status),
        sanitizeCSV(p.partner_name),
        sanitizeCSV(p.email),
        sanitizeCSV(p.mobile),
        sanitizeCSV(app?.alt_mobile || "N/A"),
        sanitizeCSV(app?.pan_number || "N/A"),
        sanitizeCSV(app?.dob ? formatToDDMMYYYY(app.dob) : "N/A"),
        sanitizeCSV(app?.gender || "N/A"),
        sanitizeCSV(app?.qualification || "N/A"),
        sanitizeCSV(app?.father_name || "N/A"),
        sanitizeCSV(p.role),
        sanitizeCSV(p.role_aadhaar ? "YES" : "NO"),
        sanitizeCSV(p.aadhaar_operator_id || "N/A"),
        sanitizeCSV(p.aadhaar_station_id || "N/A"),
        sanitizeCSV(loc?.center_code || "NO-CODE"),
        sanitizeCSV(loc?.center_name || "Unassigned"),
        sanitizeCSV(p.parentHqName),
        sanitizeCSV(loc?.taluk || app?.taluk || "N/A"),
        sanitizeCSV(loc?.dist || app?.dist || "N/A"),
        sanitizeCSV(loc?.state || app?.state || "N/A"),
        sanitizeCSV(loc?.pin_code || app?.pin_code || "N/A"),
        sanitizeCSV(ctopList || "None"),
        sanitizeCSV(p.tc_accepted ? "YES" : "NO"),
        sanitizeCSV(p.compliance_docs_url ? "YES" : "PENDING"),
        p.telecomDue.toFixed(2),
        p.aadhaarDue.toFixed(2),
        p.totalNetPayable.toFixed(2),
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Master_Partner_Database_${
      new Date().toISOString().split("T")[0]
    }.csv`;
    link.click();
  };

  // Summary KPIs
  const totalActiveCount = enrichedPartners.filter(
    (p) => p.status === "Active"
  ).length;
  const totalSuspendedCount = enrichedPartners.filter(
    (p) => p.status === "Suspended"
  ).length;
  const totalAadhaarOpsCount = enrichedPartners.filter(
    (p) => p.role_aadhaar || p.aadhaar_station_id
  ).length;
  const totalComplianceSecuredCount = enrichedPartners.filter(
    (p) => p.compliance_docs_url
  ).length;

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-[1500px] mx-auto space-y-6">
        {/* HEADER & MASTER CSV EXPORT */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <Link
              href="/dashboard"
              className="text-blue-600 font-black text-xs uppercase tracking-widest mb-1.5 hover:underline inline-flex items-center gap-1"
            >
              &larr; Back to Command Center
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span>🤝</span> Master Partner Database &amp; 360° Profile Hub
            </h1>
            <p className="text-slate-500 mt-1 text-sm font-medium">
              Inspect complete KYC dossiers, passport photos, CTOP &amp; bank
              mappings, live pending balances, and dispatch direct partner
              alerts.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 w-full md:w-auto">
            <button
              onClick={fetchPartnersDatabase}
              className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition"
            >
              ↻ Refresh
            </button>
            <button
              onClick={handleExportMasterDatabaseCSV}
              className="bg-slate-900 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md transition flex items-center gap-2"
            >
              📥 Export Master Database CSV ({filteredPartners.length})
            </button>
          </div>
        </div>

        {/* TOP KPI SUMMARY STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-slate-900">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
              Total Network
            </p>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {enrichedPartners.length}
            </p>
            <p className="text-[10px] font-bold text-slate-500 mt-0.5">
              Filtered: {filteredPartners.length}
            </p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-emerald-500">
            <p className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">
              Active Partners
            </p>
            <p className="text-2xl font-black text-emerald-700 mt-1">
              {totalActiveCount}
            </p>
            <p className="text-[10px] font-bold text-red-500 mt-0.5">
              Suspended: {totalSuspendedCount}
            </p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-amber-500">
            <p className="text-[10px] font-black uppercase text-amber-700 tracking-widest">
              Aadhaar Operators
            </p>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {totalAadhaarOpsCount}
            </p>
            <p className="text-[10px] font-bold text-slate-500 mt-0.5">
              Bound with Station IDs
            </p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-600">
            <p className="text-[10px] font-black uppercase text-blue-700 tracking-widest">
              Compliance Secured
            </p>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {totalComplianceSecuredCount}
            </p>
            <p className="text-[10px] font-bold text-slate-500 mt-0.5">
              Pending Upload:{" "}
              {Math.max(0, enrichedPartners.length - totalComplianceSecuredCount)}
            </p>
          </div>

          <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md border-l-4 border-l-red-500 col-span-2 md:col-span-1">
            <p className="text-[10px] font-black uppercase text-amber-400 tracking-widest">
              Filtered Pending Due
            </p>
            <p className="text-2xl font-black text-white mt-1">
              ₹
              {filteredPartners
                .reduce((sum, p) => sum + p.totalNetPayable, 0)
                .toLocaleString("en-IN")}
            </p>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
              Telecom + Aadhaar Dues
            </p>
          </div>
        </div>

        {/* 4-TIER CASCADING FILTER + STATUS + SEARCH CONSOLE */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">
                1. State
              </label>
              <select
                value={fState}
                onChange={(e) => {
                  setFState(e.target.value);
                  setFHq("ALL");
                  setFCenter("ALL");
                }}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
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
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">
                2. Master HQ
              </label>
              <select
                value={fHq}
                onChange={(e) => {
                  setFHq(e.target.value);
                  setFCenter("ALL");
                }}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All Master HQs</option>
                {hqOptions.map((hq) => (
                  <option key={hq.id} value={hq.id}>
                    {hq.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">
                3. Location (Center)
              </label>
              <select
                value={fCenter}
                onChange={(e) => setFCenter(e.target.value)}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All Centers</option>
                {centerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.center_code || "NO-CODE"}] {c.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">
                4. Operational Role
              </label>
              <select
                value={fRole}
                onChange={(e) => setFRole(e.target.value)}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All Roles</option>
                <option value="AADHAAR">🆔 Aadhaar Kendra Operators</option>
                <option value="OCSC">📡 OCSC Associates</option>
                <option value="CM">📱 Consumer Mobility (CM)</option>
                <option value="PARTNER">🏢 Franchise Partners</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">
                5. Account Status
              </label>
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All Statuses</option>
                <option value="Active">🟢 Active Only</option>
                <option value="Suspended">🔴 Suspended Only</option>
                <option value="Pending">⏳ Pending Review</option>
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <input
              type="text"
              placeholder="Search by Partner Name, Mobile, Email, PAN Number, Center Code, UIDAI Operator ID, or Station ID..."
              className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none focus:border-blue-500 text-sm font-bold bg-slate-50 focus:bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* MASTER DIRECTORY TABLE */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-slate-900 text-white text-[10px] uppercase tracking-wider">
                  <th className="p-4 font-black">Partner Identity</th>
                  <th className="p-4 font-black">Contact &amp; PAN</th>
                  <th className="p-4 font-black">Role &amp; Aadhaar / CTOP</th>
                  <th className="p-4 font-black">Mapped Center &amp; HQ</th>
                  <th className="p-4 font-black text-right">Net Pending Due</th>
                  <th className="p-4 font-black text-center">
                    Compliance Vault
                  </th>
                  <th className="p-4 font-black text-right">
                    360° Profile &amp; Controls
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-16">
                      <div className="flex justify-center items-center">
                        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                      </div>
                    </td>
                  </tr>
                ) : filteredPartners.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-12 text-center text-slate-400 font-bold text-base bg-slate-50"
                    >
                      No partner records match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredPartners.map((partner) => (
                    <tr
                      key={partner.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        partner.status === "Suspended" ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-900 text-white font-black text-xs flex items-center justify-center shrink-0">
                            {String(partner.partner_name || "P")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => open360ProfileModal(partner, "kyc")}
                              className="font-black text-sm text-slate-900 hover:text-blue-600 hover:underline text-left block"
                            >
                              {partner.partner_name}
                            </button>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 font-bold">
                                Joined:{" "}
                                {formatToDDMMYYYY(
                                  String(partner.joined_at || "").split("T")[0]
                                )}
                              </span>
                              {partner.tc_accepted ? (
                                <span className="text-[9px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                  T&amp;C ✓
                                </span>
                              ) : (
                                <span className="text-[9px] font-black text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                  T&amp;C Pending
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="font-black text-slate-800">
                          📞 {partner.mobile}
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium">
                          {partner.email}
                        </div>
                        {partner.linkedApp?.pan_number && (
                          <span className="inline-block mt-0.5 text-[9px] font-mono font-black bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                            PAN: {partner.linkedApp.pan_number}
                          </span>
                        )}
                      </td>

                      <td className="p-4">
                        <span className="text-blue-700 font-black uppercase block">
                          {partner.role}
                        </span>
                        {(partner.role_aadhaar ||
                          partner.aadhaar_operator_id ||
                          partner.aadhaar_station_id) && (
                          <div className="mt-1 inline-flex items-center gap-1 bg-amber-100 text-amber-950 border border-amber-300 px-2 py-0.5 rounded text-[10px] font-black">
                            <span>
                              🆔 {partner.aadhaar_operator_id || "NO-OP"}
                            </span>
                            <span>|</span>
                            <span>
                              Stn: {partner.aadhaar_station_id || "N/A"}
                            </span>
                          </div>
                        )}
                        {partner.pCtops?.length > 0 && (
                          <div className="text-[10px] font-bold text-indigo-700 mt-1">
                            📡 {partner.pCtops.length} CTOP(s) Mapped
                          </div>
                        )}
                      </td>

                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black bg-slate-200 text-slate-800 px-2 py-0.5 rounded uppercase">
                            {partner.locations?.center_code || "NO-CODE"}
                          </span>
                          <span className="font-bold text-slate-800">
                            {partner.locations?.center_name || "Unassigned"}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-bold mt-0.5">
                          HQ: {partner.parentHqName} •{" "}
                          {partner.locations?.dist} ({partner.locations?.state})
                        </div>
                      </td>

                      <td className="p-4 text-right">
                        <p
                          className={`font-black text-sm ${
                            partner.totalNetPayable > 1000
                              ? "text-red-600"
                              : partner.totalNetPayable > 0
                              ? "text-amber-600"
                              : "text-emerald-600"
                          }`}
                        >
                          ₹{partner.totalNetPayable.toLocaleString("en-IN")}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400">
                          Tel: ₹{partner.telecomDue.toLocaleString("en-IN")} |
                          Adh: ₹{partner.aadhaarDue.toLocaleString("en-IN")}
                        </p>
                      </td>

                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {partner.compliance_docs_url ? (
                            <button
                              onClick={() =>
                                handleViewCompliance(
                                  partner.id,
                                  partner.compliance_docs_url
                                )
                              }
                              disabled={loadingDocId === partner.id}
                              className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-black text-[10px] px-2.5 py-1 rounded-lg shadow-sm transition inline-flex items-center gap-1 disabled:opacity-50"
                            >
                              <span>📑</span>
                              {loadingDocId === partner.id
                                ? "Opening..."
                                : "Compliance PDF"}
                            </button>
                          ) : (
                            <span className="text-[9px] uppercase tracking-widest font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                              Compliance Pending
                            </span>
                          )}
                          {partner.linkedApp && (
                            <button
                              type="button"
                              onClick={() =>
                                open360ProfileModal(partner, "vault")
                              }
                              className="text-[9px] font-black text-slate-500 hover:text-slate-900 underline"
                            >
                              + Application KYC
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex justify-end items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => open360ProfileModal(partner, "kyc")}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-900 hover:bg-blue-600 text-white shadow-sm transition"
                          >
                            👤 360° Profile
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              open360ProfileModal(partner, "alert")
                            }
                            title="Send Direct Alert to Partner"
                            className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 transition"
                          >
                            💬 Alert
                          </button>

                          <button
                            type="button"
                            onClick={() => openMappingModal(partner)}
                            className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 shadow-sm transition"
                          >
                            🆔 Map ID
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              togglePartnerStatus(partner.id, partner.status)
                            }
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors border shadow-sm ${
                              partner.status === "Active"
                                ? "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200"
                                : "bg-red-100 text-red-800 border-red-200 hover:bg-red-200"
                            }`}
                          >
                            {partner.status === "Active"
                              ? "🟢 Active"
                              : "🔴 Suspended"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODAL 1: 360° PARTNER PROFILE INSPECTOR, INLINE EDITOR & ALERT HUB    */}
      {/* ===================================================================== */}
      {selectedProfile && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl my-6 overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[92vh]">
            {/* MODAL HEADER */}
            <div className="p-5 bg-slate-950 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-4 border-blue-600 shrink-0">
              <div className="flex items-center gap-3.5">
                {photoSignedUrl ? (
                  <img
                    src={photoSignedUrl}
                    alt={selectedProfile.partner_name}
                    className="w-14 h-16 object-cover rounded-xl border-2 border-white shadow-md shrink-0 bg-white"
                  />
                ) : (
                  <div className="w-14 h-16 rounded-xl bg-blue-600 text-white font-black text-xl flex items-center justify-center border-2 border-blue-400 shrink-0">
                    {String(selectedProfile.partner_name || "P")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black text-white">
                      {selectedProfile.partner_name}
                    </h2>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase ${
                        selectedProfile.status === "Active"
                          ? "bg-emerald-500 text-slate-950"
                          : "bg-red-500 text-white"
                      }`}
                    >
                      {selectedProfile.status}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-500/20 text-blue-300 border border-blue-500/40">
                      {selectedProfile.role}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-bold mt-1">
                    📍 [{selectedProfile.locations?.center_code || "NO-CODE"}]{" "}
                    {selectedProfile.locations?.center_name || "Unassigned"} •
                    HQ: {selectedProfile.parentHqName}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                    ✉️ {selectedProfile.email} (🔒 Login ID) • 📞{" "}
                    {selectedProfile.mobile}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedProfile(null)}
                className="text-3xl font-black text-slate-400 hover:text-white self-end sm:self-center"
              >
                &times;
              </button>
            </div>

            {/* 5-TAB NAVIGATION BAR */}
            <div className="bg-slate-900 px-4 py-2 flex flex-wrap gap-1.5 border-b border-slate-800 shrink-0 text-[11px] font-black uppercase tracking-wider">
              {[
                { id: "kyc", icon: "🪪", label: "1. Personal & KYC" },
                {
                  id: "mappings",
                  icon: "📡",
                  label: `2. Center, CTOP (${selectedProfile.pCtops.length}) & Bank`,
                },
                { id: "vault", icon: "📂", label: "3. Document Vault" },
                {
                  id: "ledger",
                  icon: "💰",
                  label: `4. Live Ledger (₹${selectedProfile.totalNetPayable.toLocaleString(
                    "en-IN"
                  )})`,
                },
                {
                  id: "alert",
                  icon: "💬",
                  label: `5. Send Alert (${selectedProfile.pMessages.length})`,
                },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDossierTab(t.id as DossierTab)}
                  className={`px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 ${
                    dossierTab === t.id
                      ? "bg-blue-600 text-white shadow"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* MODAL BODY */}
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 space-y-6 text-xs">
              {/* ============================================================= */}
              {/* TAB 1: PERSONAL & KYC IDENTITY + LOGIN-SAFE INLINE EDITOR     */}
              {/* ============================================================= */}
              {dossierTab === "kyc" && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-200">
                    <div>
                      <h3 className="font-black text-sm text-slate-900 uppercase tracking-wider">
                        Applicant KYC &amp; Demographic Record
                      </h3>
                      <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                        Editing profile details below updates the directory and
                        application record while keeping their login email &amp;
                        session 100% intact.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(!isEditingProfile)}
                      className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-sm transition shrink-0 ${
                        isEditingProfile
                          ? "bg-slate-200 text-slate-800"
                          : "bg-slate-900 hover:bg-blue-600 text-white"
                      }`}
                    >
                      {isEditingProfile
                        ? "✕ Cancel Editing"
                        : "✏️ Edit Profile Details"}
                    </button>
                  </div>

                  {isEditingProfile ? (
                    <form
                      onSubmit={handleSaveInlineProfile}
                      className="bg-white p-5 rounded-xl border-2 border-blue-300 shadow-sm space-y-4"
                    >
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                        <span className="font-bold text-blue-950">
                          🔒 Login Email ID:{" "}
                          <strong>{selectedProfile.email}</strong> (Locked so
                          partner login is never disrupted)
                        </span>
                        <span className="text-[10px] font-black uppercase bg-blue-600 text-white px-2 py-0.5 rounded">
                          Login Protected
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Full Name *
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={45}
                            value={profileEditForm.partner_name}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                partner_name: e.target.value.toUpperCase(),
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black uppercase"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Primary Mobile (10 Digits) *
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={10}
                            value={profileEditForm.mobile}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                mobile: e.target.value.replace(/\D/g, ""),
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Alt Mobile (Optional)
                          </label>
                          <input
                            type="text"
                            maxLength={10}
                            value={profileEditForm.alt_mobile}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                alt_mobile: e.target.value.replace(/\D/g, ""),
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            PAN Card Number
                          </label>
                          <input
                            type="text"
                            maxLength={10}
                            value={profileEditForm.pan_number}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                pan_number: e.target.value
                                  .replace(/[^A-Za-z0-9]/g, "")
                                  .toUpperCase(),
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-mono font-black uppercase"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Guardian / Father Name
                          </label>
                          <input
                            type="text"
                            value={profileEditForm.father_name}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                father_name: e.target.value.toUpperCase(),
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold uppercase"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Operational Role
                          </label>
                          <select
                            value={profileEditForm.role}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                role: e.target.value,
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black bg-white"
                          >
                            <option value="OCSC">OCSC</option>
                            <option value="AADHAAR CENTER">
                              AADHAAR CENTER
                            </option>
                            <option value="CM (CONSUMER MOBILITY)">
                              CM (CONSUMER MOBILITY)
                            </option>
                            <option value="PARTNER">PARTNER</option>
                            <option value="IRCTC AGENT">IRCTC AGENT</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Date of Birth
                          </label>
                          <input
                            type="date"
                            value={profileEditForm.dob}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                dob: e.target.value,
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Gender
                          </label>
                          <select
                            value={profileEditForm.gender}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                gender: e.target.value,
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold bg-white"
                          >
                            <option value="">Select</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Transgender">Transgender</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Qualification
                          </label>
                          <select
                            value={profileEditForm.qualification}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                qualification: e.target.value,
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold bg-white"
                          >
                            <option value="">Select</option>
                            <option value="10th">10th</option>
                            <option value="12th">12th</option>
                            <option value="Graduate">Graduate</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            Address Line 1
                          </label>
                          <input
                            type="text"
                            value={profileEditForm.address_1}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                address_1: e.target.value.toUpperCase(),
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold uppercase"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                            PIN Code
                          </label>
                          <input
                            type="text"
                            maxLength={6}
                            value={profileEditForm.pin_code}
                            onChange={(e) =>
                              setProfileEditForm({
                                ...profileEditForm,
                                pin_code: e.target.value.replace(/\D/g, ""),
                              })
                            }
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setIsEditingProfile(false)}
                          className="px-4 py-2.5 bg-slate-100 text-slate-700 font-black uppercase rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSavingProfile}
                          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase rounded-lg shadow"
                        >
                          {isSavingProfile
                            ? "Saving Profile..."
                            : "💾 Save Profile Changes (Login Safe)"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                      {/* PASSPORT PHOTO & SESSION SECURITY CARD */}
                      <div className="lg:col-span-4 bg-white p-5 rounded-xl border border-slate-200 flex flex-col items-center text-center justify-between space-y-4">
                        <div className="w-full flex flex-col items-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                            Applicant Passport Photo
                          </span>
                          {photoSignedUrl ? (
                            <a
                              href={photoSignedUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                src={photoSignedUrl}
                                alt="Passport Photo"
                                className="w-32 h-40 object-cover rounded-xl border-4 border-slate-100 shadow-md"
                              />
                            </a>
                          ) : (
                            <div className="w-32 h-40 rounded-xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 font-bold text-xs">
                              No Photo on File
                            </div>
                          )}
                        </div>

                        <div className="w-full bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-left space-y-1.5">
                          <p className="text-[9px] font-black uppercase text-slate-400">
                            Security &amp; Terms Telemetry
                          </p>
                          <p className="font-bold text-slate-800">
                            Terms Wall:{" "}
                            <strong
                              className={
                                selectedProfile.tc_accepted
                                  ? "text-emerald-600"
                                  : "text-amber-600"
                              }
                            >
                              {selectedProfile.tc_accepted
                                ? "✅ Accepted"
                                : "⏳ Pending"}
                            </strong>
                          </p>
                          <p className="font-bold text-slate-700">
                            Application IP:{" "}
                            <strong>
                              {selectedProfile.linkedApp?.ip_address || "N/A"}
                            </strong>
                          </p>
                          <p className="font-bold text-slate-700">
                            Last Active IP:{" "}
                            <strong>
                              {selectedProfile.activeSession?.ip_address ||
                                "Offline"}
                            </strong>
                          </p>
                          {selectedProfile.activeSession?.last_active && (
                            <p className="text-[10px] text-slate-500 font-bold">
                              Seen:{" "}
                              {new Date(
                                selectedProfile.activeSession.last_active
                              ).toLocaleString("en-IN")}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* DEMOGRAPHIC & ADDRESS GRID */}
                      <div className="lg:col-span-8 bg-white p-5 rounded-xl border border-slate-200 space-y-5">
                        <div>
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 border-b pb-1.5 mb-3">
                            1. Personal &amp; KYC Credentials
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Full Name
                              </span>
                              <span className="font-black text-slate-900">
                                {selectedProfile.partner_name}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Guardian / Father
                              </span>
                              <span className="font-bold text-slate-800">
                                {selectedProfile.linkedApp?.father_name ||
                                  "N/A"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                DOB &amp; Gender
                              </span>
                              <span className="font-bold text-slate-800">
                                {selectedProfile.linkedApp?.dob
                                  ? formatToDDMMYYYY(
                                      selectedProfile.linkedApp.dob
                                    )
                                  : "N/A"}{" "}
                                ({selectedProfile.linkedApp?.gender || "N/A"})
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                PAN Number
                              </span>
                              <span className="font-mono font-black text-slate-900">
                                {selectedProfile.linkedApp?.pan_number ||
                                  "Not Provided"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Gov ID Status
                              </span>
                              <span className="font-bold text-slate-700">
                                {selectedProfile.linkedApp?.gov_id_number
                                  ? "[Redacted - Verified on File]"
                                  : "N/A"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Qualification
                              </span>
                              <span className="font-bold text-slate-800">
                                {selectedProfile.linkedApp?.qualification ||
                                  "N/A"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Primary Mobile
                              </span>
                              <span className="font-black text-slate-900">
                                {selectedProfile.mobile}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Alt Mobile
                              </span>
                              <span className="font-bold text-slate-800">
                                {selectedProfile.linkedApp?.alt_mobile || "N/A"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Registered Email
                              </span>
                              <span className="font-bold text-blue-700 break-all">
                                {selectedProfile.email}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-600 border-b pb-1.5 mb-3">
                            2. Residential Address (From Application)
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Street Address
                              </span>
                              <span className="font-bold text-slate-800">
                                {selectedProfile.linkedApp?.address_1 || "N/A"}
                                {selectedProfile.linkedApp?.address_2
                                  ? `, ${selectedProfile.linkedApp.address_2}`
                                  : ""}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">
                                Taluk, District &amp; State
                              </span>
                              <span className="font-bold text-slate-800">
                                {selectedProfile.linkedApp?.taluk ||
                                  selectedProfile.locations?.taluk ||
                                  "N/A"}
                                ,{" "}
                                {selectedProfile.linkedApp?.dist ||
                                  selectedProfile.locations?.dist ||
                                  "N/A"}
                                ,{" "}
                                {selectedProfile.linkedApp?.state ||
                                  selectedProfile.locations?.state ||
                                  "N/A"}{" "}
                                -{" "}
                                {selectedProfile.linkedApp?.pin_code ||
                                  selectedProfile.locations?.pin_code ||
                                  "N/A"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================= */}
              {/* TAB 2: CENTER, CTOP & BANK TREASURY MAPPINGS                  */}
              {/* ============================================================= */}
              {dossierTab === "mappings" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-widest text-amber-700 border-b pb-2">
                      1. Assigned Center &amp; Aadhaar Station IDs
                    </h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          Center [Code]:
                        </span>
                        <span className="font-black text-slate-900">
                          [{selectedProfile.locations?.center_code || "NO-CODE"}
                          ] {selectedProfile.locations?.center_name}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          Parent Master HQ:
                        </span>
                        <span className="font-black text-indigo-700">
                          {selectedProfile.parentHqName}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          BA / OA Zone:
                        </span>
                        <span className="font-bold text-slate-800">
                          BA: {selectedProfile.locations?.ba || "N/A"} | OA:{" "}
                          {selectedProfile.locations?.oa || "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          UIDAI Operator ID:
                        </span>
                        <span className="font-black text-blue-700">
                          {selectedProfile.aadhaar_operator_id || "UNMAPPED"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          UIDAI Station ID:
                        </span>
                        <span className="font-black text-amber-700">
                          {selectedProfile.aadhaar_station_id || "UNMAPPED"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-widest text-blue-700 border-b pb-2">
                      2. Mapped Agent CTOP Credentials (
                      {selectedProfile.pCtops.length})
                    </h4>
                    {selectedProfile.pCtops.length === 0 ? (
                      <p className="text-slate-400 font-bold py-4 text-center">
                        No Agent CTOP numbers mapped to this partner.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedProfile.pCtops.map((c: any) => (
                          <div
                            key={c.id}
                            className="p-3 bg-blue-50/50 border border-blue-200 rounded-lg flex justify-between items-center"
                          >
                            <div>
                              <p className="font-black text-slate-900">
                                Agent CTOP: {c.agent_ctop_no}
                              </p>
                              <p className="text-[10px] font-bold text-slate-500">
                                Login ID: {c.agent_ocsc_login_id} • Master:{" "}
                                {c.master_ctop_accounts?.master_ctop_no ||
                                  "N/A"}
                              </p>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                c.is_active
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {c.is_active ? "Active" : "Off"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2 bg-white p-5 rounded-xl border border-slate-200 space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 border-b pb-2">
                      3. Center Treasury Channels (CMS Virtual Accounts &amp;
                      UPI IDs)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-2">
                          CMS Virtual Accounts (
                          {selectedProfile.pVirtuals.length})
                        </p>
                        {selectedProfile.pVirtuals.length === 0 ? (
                          <p className="text-slate-400 font-bold">
                            No Virtual Accounts mapped to this center.
                          </p>
                        ) : (
                          selectedProfile.pVirtuals.map((v: any) => (
                            <div
                              key={v.id}
                              className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg mb-2"
                            >
                              <p className="font-black text-slate-900">
                                {v.virtual_account_no}
                              </p>
                              <p className="text-[10px] font-bold text-slate-600">
                                IFSC: {v.virtual_ifsc} ({v.master_banks?.bank_name})
                              </p>
                            </div>
                          ))
                        )}
                      </div>

                      <div>
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-2">
                          Official UPI IDs ({selectedProfile.pUpis.length})
                        </p>
                        {selectedProfile.pUpis.length === 0 ? (
                          <p className="text-slate-400 font-bold">
                            No UPI IDs mapped to this center.
                          </p>
                        ) : (
                          selectedProfile.pUpis.map((u: any) => (
                            <div
                              key={u.id}
                              className="p-3 bg-purple-50/60 border border-purple-200 rounded-lg mb-2"
                            >
                              <p className="font-black text-purple-900">
                                {u.upi_id}
                              </p>
                              <p className="text-[10px] font-bold text-slate-600">
                                Bank: {u.master_banks?.bank_name}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================= */}
              {/* TAB 3: UNIFIED DOCUMENT VAULT (EMBEDDED PDF PREVIEWER)        */}
              {/* ============================================================= */}
              {dossierTab === "vault" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-black uppercase text-blue-600">
                          Dossier 1
                        </span>
                        <h4 className="font-black text-slate-900 text-sm mt-0.5">
                          Onboarding Application &amp; KYC PDF
                        </h4>
                        <p className="text-[11px] text-slate-500 font-medium mt-1">
                          A4 application form merged with POI, POA &amp; PAN
                          from /apply.
                        </p>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          type="button"
                          disabled={isLoadingVaultPreview}
                          onClick={() =>
                            handleLoadVaultDocument("ONBOARDING_KYC", "preview")
                          }
                          className="flex-1 bg-slate-900 hover:bg-blue-600 text-white font-black py-2 rounded-lg text-[10px] uppercase"
                        >
                          👁️ Preview Below
                        </button>
                        <button
                          type="button"
                          disabled={isLoadingVaultPreview}
                          onClick={() =>
                            handleLoadVaultDocument("ONBOARDING_KYC", "open")
                          }
                          className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-black px-3 py-2 rounded-lg text-[10px] uppercase border border-slate-300"
                        >
                          ↗ Tab
                        </button>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-black uppercase text-emerald-600">
                          Dossier 2
                        </span>
                        <h4 className="font-black text-slate-900 text-sm mt-0.5">
                          Operational Compliance PDF
                        </h4>
                        <p className="text-[11px] text-slate-500 font-medium mt-1">
                          {selectedProfile.compliance_docs_url
                            ? "✅ Uploaded & Locked in Vault"
                            : "⏳ Pending Partner Upload"}
                        </p>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          type="button"
                          disabled={
                            !selectedProfile.compliance_docs_url ||
                            isLoadingVaultPreview
                          }
                          onClick={() =>
                            handleLoadVaultDocument(
                              "COMPLIANCE_DOSSIER",
                              "preview"
                            )
                          }
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black py-2 rounded-lg text-[10px] uppercase"
                        >
                          👁️ Preview Below
                        </button>
                        <button
                          type="button"
                          disabled={
                            !selectedProfile.compliance_docs_url ||
                            isLoadingVaultPreview
                          }
                          onClick={() =>
                            handleLoadVaultDocument(
                              "COMPLIANCE_DOSSIER",
                              "open"
                            )
                          }
                          className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-800 font-black px-3 py-2 rounded-lg text-[10px] uppercase border border-slate-300"
                        >
                          ↗ Tab
                        </button>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-black uppercase text-amber-600">
                          Dossier 3
                        </span>
                        <h4 className="font-black text-slate-900 text-sm mt-0.5">
                          Aadhaar Upgrade Compliance PDF
                        </h4>
                        <p className="text-[11px] text-slate-500 font-medium mt-1">
                          {selectedProfile.latestUpgrade?.compliance_pdf_url
                            ? `✅ Submitted (${selectedProfile.latestUpgrade.status})`
                            : "No Aadhaar Upgrade Dossier"}
                        </p>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          type="button"
                          disabled={
                            !selectedProfile.latestUpgrade
                              ?.compliance_pdf_url || isLoadingVaultPreview
                          }
                          onClick={() =>
                            handleLoadVaultDocument(
                              "AADHAAR_UPGRADE",
                              "preview"
                            )
                          }
                          className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-black py-2 rounded-lg text-[10px] uppercase"
                        >
                          👁️ Preview Below
                        </button>
                        <button
                          type="button"
                          disabled={
                            !selectedProfile.latestUpgrade
                              ?.compliance_pdf_url || isLoadingVaultPreview
                          }
                          onClick={() =>
                            handleLoadVaultDocument("AADHAAR_UPGRADE", "open")
                          }
                          className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-800 font-black px-3 py-2 rounded-lg text-[10px] uppercase border border-slate-300"
                        >
                          ↗ Tab
                        </button>
                      </div>
                    </div>
                  </div>

                  {previewPdfUrl ? (
                    <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
                      <div className="p-3 bg-slate-950 text-white flex justify-between items-center">
                        <span className="font-black text-xs text-amber-400 uppercase">
                          📄 {previewPdfTitle}
                        </span>
                        <a
                          href={previewPdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-blue-600 text-white px-3 py-1 rounded text-[10px] font-black uppercase"
                        >
                          Open Full Screen ↗
                        </a>
                      </div>
                      <iframe
                        src={`${previewPdfUrl}#toolbar=0`}
                        className="w-full h-[440px] bg-white"
                        title="Partner Vault Document Preview"
                      />
                    </div>
                  ) : (
                    <div className="bg-white p-10 rounded-xl border border-slate-200 text-center text-slate-400 font-bold">
                      Click &quot;👁️ Preview Below&quot; on any dossier above to
                      inspect the watermarked PDF right here.
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================= */}
              {/* TAB 4: LIVE FINANCIAL & ACTIVITY SNAPSHOT                     */}
              {/* ============================================================= */}
              {dossierTab === "ledger" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-5 rounded-xl border border-slate-200 border-t-4 border-t-indigo-600 space-y-2">
                      <p className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">
                        1. BSNL + Paybull Stream
                      </p>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          Cash Generated:
                        </span>
                        <span className="font-black text-slate-900">
                          ₹
                          {selectedProfile.telecomGenerated.toLocaleString(
                            "en-IN"
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          Less Deposited:
                        </span>
                        <span className="font-black text-emerald-600">
                          - ₹
                          {selectedProfile.telecomDeposited.toLocaleString(
                            "en-IN"
                          )}
                        </span>
                      </div>
                      <div className="pt-2 border-t flex justify-between text-sm">
                        <span className="font-black text-slate-800">
                          Telecom Due:
                        </span>
                        <span className="font-black text-red-600">
                          ₹{selectedProfile.telecomDue.toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>

                    <div className="bg-white p-5 rounded-xl border border-slate-200 border-t-4 border-t-amber-500 space-y-2">
                      <p className="text-[10px] font-black uppercase text-amber-700 tracking-widest">
                        2. Aadhaar Kendra Stream (
                        {selectedProfile.aadhaarPackets} Pkts)
                      </p>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          Cash Collected:
                        </span>
                        <span className="font-black text-slate-900">
                          ₹
                          {selectedProfile.aadhaarGenerated.toLocaleString(
                            "en-IN"
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          Less Deposited:
                        </span>
                        <span className="font-black text-emerald-600">
                          - ₹
                          {selectedProfile.aadhaarDeposited.toLocaleString(
                            "en-IN"
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-bold">
                          Unpaid Late Fines:
                        </span>
                        <span className="font-black text-red-600">
                          + ₹
                          {selectedProfile.aadhaarPenaltyDue.toLocaleString(
                            "en-IN"
                          )}
                        </span>
                      </div>
                      <div className="pt-2 border-t flex justify-between text-sm">
                        <span className="font-black text-slate-800">
                          Aadhaar Due:
                        </span>
                        <span className="font-black text-red-600">
                          ₹{selectedProfile.aadhaarDue.toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-900 text-white p-5 rounded-xl flex flex-col justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase text-amber-400 tracking-widest">
                          3. Combined Net Balance Payable
                        </p>
                        <p className="text-3xl font-black text-white mt-2">
                          ₹
                          {selectedProfile.totalNetPayable.toLocaleString(
                            "en-IN",
                            { minimumFractionDigits: 2 }
                          )}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold mt-1">
                          Total Unsettled Cash Across All Streams
                        </p>
                      </div>
                      {selectedProfile.totalNetPayable > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAlertSubjectCategory("Deposit pending notice");
                            setAlertBody(
                              `Dear ${selectedProfile.partner_name}, your net pending cash balance across Telecom/Aadhaar is ₹${selectedProfile.totalNetPayable.toLocaleString("en-IN")}. Please remit your pending dues immediately and upload the receipt.`
                            );
                            setDossierTab("alert");
                          }}
                          className="mt-4 w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-black text-[10px] uppercase tracking-widest rounded-lg shadow transition"
                        >
                          🚨 Send Deposit Reminder Alert &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================= */}
              {/* TAB 5: DIRECT "SEND ALERT TO PARTNER" QUICK-ACTION            */}
              {/* ============================================================= */}
              {dossierTab === "alert" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-5 bg-white p-5 rounded-xl border border-slate-200 space-y-4 h-fit">
                    <h4 className="font-black text-sm text-slate-900 uppercase tracking-wider border-b pb-2">
                      💬 Dispatch Priority Alert to{" "}
                      {selectedProfile.partner_name}
                    </h4>

                    <form
                      onSubmit={handleSendDirectAlert}
                      className="space-y-3.5"
                    >
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                          Notice Subject Heading *
                        </label>
                        <select
                          required
                          value={alertSubjectCategory}
                          onChange={(e) => {
                            setAlertSubjectCategory(e.target.value);
                            setAlertCustomSubject("");
                          }}
                          className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold bg-slate-50"
                        >
                          <option value="" disabled>
                            -- Select Notice Type --
                          </option>
                          {ALERT_SUBJECT_PRESETS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>

                      {alertSubjectCategory === "Other (Custom Subject)" && (
                        <div>
                          <label className="block text-[10px] font-black uppercase text-purple-700 mb-1">
                            Custom Subject *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="ENTER CUSTOM SUBJECT..."
                            value={alertCustomSubject}
                            onChange={(e) =>
                              setAlertCustomSubject(
                                e.target.value.toUpperCase()
                              )
                            }
                            className="w-full border-2 border-purple-300 p-2.5 rounded-lg font-black uppercase"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                          Alert Message Body *
                        </label>
                        <textarea
                          rows={4}
                          required
                          placeholder="Type compliance instructions for this partner..."
                          value={alertBody}
                          onChange={(e) => setAlertBody(e.target.value)}
                          className="w-full border-2 border-slate-200 p-3 rounded-lg font-medium"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSendingAlert}
                        className="w-full py-3 bg-slate-900 hover:bg-purple-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow transition"
                      >
                        {isSendingAlert
                          ? "Dispatching Alert..."
                          : "🚀 Send Alert to Partner Inbox"}
                      </button>
                    </form>
                  </div>

                  <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col max-h-96">
                    <div className="p-3.5 bg-slate-900 text-white flex justify-between items-center">
                      <span className="font-black text-xs uppercase tracking-widest">
                        Alert History for {selectedProfile.partner_name}
                      </span>
                      <span className="text-[10px] font-black bg-slate-800 text-amber-400 px-2.5 py-0.5 rounded">
                        {selectedProfile.unreadAlertsCount} Unread
                      </span>
                    </div>
                    <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
                      {selectedProfile.pMessages.length === 0 ? (
                        <p className="text-center text-slate-400 font-bold py-8">
                          No alerts have been sent to this partner yet.
                        </p>
                      ) : (
                        selectedProfile.pMessages.map((m: any) => (
                          <div
                            key={m.id}
                            className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-black text-slate-900">
                                {m.subject}
                              </span>
                              <span
                                className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                                  m.is_read
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {m.is_read ? "✅ Read" : "⏳ Unread"}
                              </span>
                            </div>
                            <p className="text-slate-600 font-medium">
                              {m.body}
                            </p>
                            <p className="text-[9px] text-slate-400 font-bold">
                              Sent:{" "}
                              {new Date(m.created_at).toLocaleString("en-IN")}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: INLINE AADHAAR & CENTER CODE MAPPING MODAL (PRESERVED)       */}
      {/* ===================================================================== */}
      {mappingPartner && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl border max-w-md w-full overflow-hidden animate-in zoom-in-95">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div>
                <h3 className="font-black text-base">
                  Map Center &amp; Aadhaar Credentials
                </h3>
                <p className="text-xs text-amber-400 font-bold mt-0.5">
                  {mappingPartner.partner_name}
                </p>
              </div>
              <button
                onClick={() => setMappingPartner(null)}
                className="text-2xl font-black text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={handleSaveMapping}
              className="p-6 space-y-4 text-xs"
            >
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  Assigned Center [Center Code] *
                </label>
                <select
                  required
                  value={mapForm.center_id}
                  onChange={(e) =>
                    setMapForm({ ...mapForm, center_id: e.target.value })
                  }
                  className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold bg-slate-50"
                >
                  <option value="" disabled>
                    -- Select Center --
                  </option>
                  {locations
                    .filter((l) => !l.is_master_node)
                    .map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        [{loc.center_code || "NO-CODE"}] {loc.center_name} (
                        {loc.state})
                      </option>
                    ))}
                </select>
              </div>

              <label className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                <div>
                  <span className="font-black text-amber-950 uppercase block">
                    Enable Aadhaar Seva Kendra Role
                  </span>
                  <span className="text-[10px] font-bold text-amber-700">
                    Allows CSV/HTML daily report uploads
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={mapForm.role_aadhaar}
                  onChange={(e) =>
                    setMapForm({ ...mapForm, role_aadhaar: e.target.checked })
                  }
                  className="w-5 h-5 accent-amber-600"
                />
              </label>

              {mapForm.role_aadhaar && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      UIDAI Operator ID *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. MYS_FAAFREEN"
                      value={mapForm.aadhaar_operator_id}
                      onChange={(e) =>
                        setMapForm({
                          ...mapForm,
                          aadhaar_operator_id: e.target.value.toUpperCase(),
                        })
                      }
                      className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      UIDAI Station ID (5 Digits) *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={5}
                      placeholder="e.g. 21505"
                      value={mapForm.aadhaar_station_id}
                      onChange={(e) =>
                        setMapForm({
                          ...mapForm,
                          aadhaar_station_id: e.target.value.replace(/\D/g, ""),
                        })
                      }
                      className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setMappingPartner(null)}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingMap}
                  className="flex-1 py-3 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-wider rounded-lg shadow"
                >
                  {isSavingMap ? "Saving..." : "Save Mapping"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}