import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Reads for the platform dashboard. Every one is a database function that
 * starts with platform_require(), run as the signed-in operator — no service
 * role here. What comes back is metadata: names, slugs, status, the one
 * administrator per community, aggregate counts. None of these functions can
 * return a message, a post, a document or a member list, and none exists that
 * could.
 *
 * A refusal or failure throws. The dashboard's error boundary shows a generic
 * sentence; the code and Postgres' own message go to the server log.
 */

type Enums = Database["public"]["Enums"];

class PlatformReadError extends Error {}

function fail(context: string, error: { code?: string; message?: string }): never {
  console.error(`[platform-admin] ${context}: ${error.code ?? "?"} ${error.message ?? ""}`);
  throw new PlatformReadError("Kunne ikke hente data fra plattformen.");
}

export interface PlatformOverview {
  communitiesTotal: number;
  communitiesActive: number;
  communitiesSuspended: number;
  requestsPending: number;
  operatorsActive: number;
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_overview");
  if (error) fail("platform_overview", error);
  const row = data?.[0];
  return {
    communitiesTotal: Number(row?.communities_total ?? 0),
    communitiesActive: Number(row?.communities_active ?? 0),
    communitiesSuspended: Number(row?.communities_suspended ?? 0),
    requestsPending: Number(row?.requests_pending ?? 0),
    operatorsActive: Number(row?.operators_active ?? 0),
  };
}

export type CommunityStatus = "active" | "suspended";

export interface PlatformCommunitySummary {
  id: string;
  slug: string;
  name: string;
  status: CommunityStatus;
  provisionedAt: string | null;
  memberCount: number;
  adminName: string | null;
  adminEmail: string | null;
  pendingAdminEmail: string | null;
  accent: string;
  monogram: string;
  markStyle: "sans" | "serif" | "mono";
}

function markStyle(value: string | null | undefined): "sans" | "serif" | "mono" {
  return value === "serif" || value === "mono" ? value : "sans";
}

export async function listPlatformCommunities(filter: {
  search?: string;
  status?: CommunityStatus;
}): Promise<PlatformCommunitySummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_communities", {
    p_search: filter.search?.slice(0, 100) || undefined,
    p_status: filter.status,
  });
  if (error) fail("platform_list_communities", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status === "suspended" ? "suspended" : "active",
    provisionedAt: row.provisioned_at ?? null,
    memberCount: Number(row.member_count ?? 0),
    adminName: row.admin_name ?? null,
    adminEmail: row.admin_email ?? null,
    pendingAdminEmail: row.pending_admin_email ?? null,
    accent: row.accent,
    monogram: row.monogram,
    markStyle: markStyle(row.mark_style),
  }));
}

export interface PlatformCommunityDetail {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  publicDescription: string;
  location: string;
  foundedYear: number;
  accent: string;
  accentSoft: string;
  monogram: string;
  markStyle: "sans" | "serif" | "mono";
  accessPolicy: Enums["access_policy"];
  defaultLocale: "nb" | "en";
  memberDirectoryVisibility: Enums["member_directory_visibility"];
  dmPolicy: Enums["dm_policy"];
  hasAvatar: boolean;
  status: CommunityStatus;
  provisionedAt: string | null;
  provisionedByEmail: string | null;
  onboardingRequestId: string | null;
  suspendedAt: string | null;
  suspendedByEmail: string | null;
  suspensionReason: string | null;
  memberCount: number;
  moderatorCount: number;
  admin: { userId: string; name: string | null; email: string | null; since: string | null } | null;
}

export async function getPlatformCommunity(id: string): Promise<PlatformCommunityDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_get_community", { p_community_id: id });
  if (error) fail("platform_get_community", error);
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    publicDescription: row.public_description,
    location: row.location,
    foundedYear: row.founded_year,
    accent: row.accent,
    accentSoft: row.accent_soft,
    monogram: row.monogram,
    markStyle: markStyle(row.mark_style),
    accessPolicy: row.access_policy,
    defaultLocale: row.default_locale === "en" ? "en" : "nb",
    memberDirectoryVisibility: row.member_directory_visibility,
    dmPolicy: row.dm_policy,
    hasAvatar: Boolean(row.has_avatar),
    status: row.status === "suspended" ? "suspended" : "active",
    provisionedAt: row.provisioned_at ?? null,
    provisionedByEmail: row.provisioned_by_email ?? null,
    onboardingRequestId: row.onboarding_request_id ?? null,
    suspendedAt: row.suspended_at ?? null,
    suspendedByEmail: row.suspended_by_email ?? null,
    suspensionReason: row.suspension_reason ?? null,
    memberCount: Number(row.member_count ?? 0),
    moderatorCount: Number(row.moderator_count ?? 0),
    admin: row.admin_user_id
      ? {
          userId: row.admin_user_id,
          name: row.admin_name ?? null,
          email: row.admin_email ?? null,
          since: row.admin_since ?? null,
        }
      : null,
  };
}

export interface PlatformAdminInvitation {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  invitedByEmail: string | null;
}

export async function listAdminInvitations(communityId: string): Promise<PlatformAdminInvitation[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_community_admin_invitations", { p_community_id: communityId });
  if (error) fail("platform_community_admin_invitations", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    invitedByEmail: row.invited_by_email ?? null,
  }));
}

export type RequestStatus = "pending" | "approved" | "rejected";

export interface OnboardingRequestSummary {
  id: string;
  createdAt: string;
  organizationName: string;
  contactName: string;
  contactEmail: string;
  memberEstimate: number | null;
  status: RequestStatus;
  reviewedAt: string | null;
  communityId: string | null;
}

function requestStatus(value: string): RequestStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

export async function listOnboardingRequests(status?: RequestStatus): Promise<OnboardingRequestSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_onboarding_requests", { p_status: status });
  if (error) fail("platform_list_onboarding_requests", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    organizationName: row.organization_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    memberEstimate: row.member_estimate ?? null,
    status: requestStatus(row.status),
    reviewedAt: row.reviewed_at ?? null,
    communityId: row.community_id ?? null,
  }));
}

export interface OnboardingRequestDetail extends OnboardingRequestSummary {
  website: string | null;
  message: string;
  reviewNote: string | null;
  reviewedByEmail: string | null;
  communityName: string | null;
}

export async function getOnboardingRequest(id: string): Promise<OnboardingRequestDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_get_onboarding_request", { p_request_id: id });
  if (error) fail("platform_get_onboarding_request", error);
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    organizationName: row.organization_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    memberEstimate: row.member_estimate ?? null,
    status: requestStatus(row.status),
    reviewedAt: row.reviewed_at ?? null,
    communityId: row.community_id ?? null,
    website: row.website ?? null,
    message: row.message,
    reviewNote: row.review_note ?? null,
    reviewedByEmail: row.reviewed_by_email ?? null,
    communityName: row.community_name ?? null,
  };
}

export interface PlatformOperatorRow {
  userId: string;
  name: string | null;
  email: string | null;
  role: "owner" | "operator";
  appointedAt: string;
  appointedByEmail: string | null;
  revokedAt: string | null;
  revokedByEmail: string | null;
  hasMfa: boolean;
  isSelf: boolean;
}

export async function listPlatformOperators(): Promise<PlatformOperatorRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_operators");
  if (error) fail("platform_list_operators", error);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    name: row.name ?? null,
    email: row.email ?? null,
    role: row.role === "owner" ? "owner" : "operator",
    appointedAt: row.appointed_at,
    appointedByEmail: row.appointed_by_email ?? null,
    revokedAt: row.revoked_at ?? null,
    revokedByEmail: row.revoked_by_email ?? null,
    hasMfa: Boolean(row.has_mfa),
    isSelf: Boolean(row.is_self),
  }));
}

export interface AuditEntry {
  id: number;
  occurredAt: string;
  actorEmail: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: "success" | "failure";
  metadata: Record<string, unknown>;
}

export async function listAuditEntries(filter: {
  limit?: number;
  beforeId?: number;
  targetType?: string;
  targetId?: string;
}): Promise<AuditEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_audit_entries", {
    p_limit: filter.limit ?? 50,
    p_before_id: filter.beforeId,
    p_target_type: filter.targetType,
    p_target_id: filter.targetId,
  });
  if (error) fail("platform_audit_entries", error);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    occurredAt: row.occurred_at,
    actorEmail: row.actor_email ?? null,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id ?? null,
    result: row.result === "failure" ? "failure" : "success",
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  }));
}
