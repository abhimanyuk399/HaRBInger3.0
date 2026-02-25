
type PillTone = "ok" | "warn" | "error" | "neutral";

export function mapConsentStatusMeta(status: string): { pill: PillTone; label: string } {
  const normalized = String(status ?? "").toUpperCase();
  if (normalized === "APPROVED") return { pill: "ok", label: "Approved" };
  if (normalized === "REJECTED") return { pill: "error", label: "Rejected" };
  if (normalized === "REVOKED") return { pill: "warn", label: "Revoked" };
  if (normalized === "EXPIRED") return { pill: "neutral", label: "Expired" };
  if (normalized === "PENDING") return { pill: "warn", label: "Pending" };
  if (normalized === "ACTIVE") return { pill: "ok", label: "Active" };
  if (normalized === "SUPERSEDED") return { pill: "neutral", label: "Superseded" };
  return { pill: "neutral", label: normalized || "Unknown" };
}
