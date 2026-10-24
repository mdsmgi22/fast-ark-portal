// FILE PATH: ./app/lib/errorCodes.ts
import { supabase } from "./supabase";

const ERROR_CATALOG: Record<string, { code: string; userMessage: string }> = {
  "23505": {
    code: "ERR-DUP-205",
    userMessage:
      "Duplicate Record Blocked: This UTR, Transaction ID, or Report Date has already been registered in the ledger.",
  },
  "23503": {
    code: "ERR-REL-203",
    userMessage:
      "Reference Error: Linked profile or center mapping could not be verified.",
  },
  "42501": {
    code: "ERR-SEC-401",
    userMessage:
      "Security Gate: Your current session does not have permission for this action.",
  },
  "PGRST116": {
    code: "ERR-LCK-116",
    userMessage:
      "Record Locked: This entry was already processed or updated.",
  },
  "STORAGE_ERR": {
    code: "ERR-VLT-301",
    userMessage:
      "Vault Storage Error: Unable to upload or retrieve the document. Verify file format and size.",
  },
  "OCR_ERR": {
    code: "ERR-OCR-404",
    userMessage:
      "Receipt Scanner Notice: Could not auto-read all fields from the slip. Please verify and enter manually.",
  },
  "CSV_HTML_MISMATCH": {
    code: "ERR-UID-422",
    userMessage:
      "Report Validation Blocked: The uploaded CSV and HTML files do not match your Operator ID, Station ID, or selected date.",
  },
  "DEFAULT": {
    code: "ERR-SYS-500",
    userMessage:
      "System Operation Failed: Unable to process the request right now. Please try again or contact support with this error code.",
  },
};

export async function reportAndMaskError(
  err: any,
  moduleName: string,
  actor?: { id?: string; email?: string; role?: string }
): Promise<string> {
  const rawMessage = String(err?.message || err || "Unknown error");
  const rawCode = String(err?.code || "");

  let matched = ERROR_CATALOG["DEFAULT"];
  if (rawCode && ERROR_CATALOG[rawCode]) {
    matched = ERROR_CATALOG[rawCode];
  } else if (
    rawMessage.toLowerCase().includes("duplicate") ||
    rawMessage.toLowerCase().includes("unique")
  ) {
    matched = ERROR_CATALOG["23505"];
  } else if (
    rawMessage.toLowerCase().includes("mismatch") ||
    rawMessage.toLowerCase().includes("parity") ||
    rawMessage.toLowerCase().includes("unrecognized uidai")
  ) {
    matched = ERROR_CATALOG["CSV_HTML_MISMATCH"];
  } else if (
    rawMessage.toLowerCase().includes("storage") ||
    rawMessage.toLowerCase().includes("bucket") ||
    rawMessage.toLowerCase().includes("upload")
  ) {
    matched = ERROR_CATALOG["STORAGE_ERR"];
  }

  try {
    await supabase.from("system_audit_logs").insert([
      {
        actor_id: actor?.id || null,
        actor_email: actor?.email || "SYSTEM",
        actor_role: actor?.role || "USER",
        module: moduleName,
        action_code: matched.code,
        metadata: { raw_code: rawCode, raw_error: rawMessage },
      },
    ]);
  } catch (_) {}

  return `[${matched.code}] ${matched.userMessage}`;
}

export async function logSystemTelemetry(params: {
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  module: string;
  actionCode: string;
  referenceId?: string;
  metadata?: Record<string, any>;
}) {
  try {
    await supabase.from("system_audit_logs").insert([
      {
        actor_id: params.actorId || null,
        actor_email: params.actorEmail || "UNKNOWN",
        actor_role: params.actorRole || "PARTNER",
        module: params.module,
        action_code: params.actionCode,
        reference_id: params.referenceId || null,
        metadata: params.metadata || {},
      },
    ]);
  } catch (_) {}
}

export function generateSystemReferenceCode(prefix: "FA-DEP" | "FA-ADH", dateStr?: string): string {
  const cleanDate = (dateStr || new Date().toISOString().split("T")[0]).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const timePart = Date.now().toString().slice(-4);
  return `${prefix}-${cleanDate}-${rand}${timePart}`;
}