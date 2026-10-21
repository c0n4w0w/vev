import { getRequestLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CollaborationProfileForm } from "@/components/collaboration/CollaborationProfileForm";
import { IconArrowLeft, IconCheck } from "@/components/ui/icons";
import { cn, PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getCollaborationBySlug,
  getMyCollaborationPersona,
  getPersonaStartingPoints,
  hasCollaborationAccess,
} from "@/lib/collaboration-data";
import { translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/profile">) {
  const { slug } = await params;
  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) return {};
  return {
    title: translator(await getRequestLocale(collaboration))("collab.profile.metaTitle", { name: collaboration.name }),
  };
}

/**
 * How the person appears in one collaboration.
 *
 * Only for someone on the organiser team — the database refuses anyone else,
 * and this page sends them back rather than showing a form that cannot save.
 *
 * The first time, the form starts EMPTY. The person may choose to start from
 * one of their own community profiles, but only from a community through which
 * they were chosen for this collaboration, and only by clicking it: the
 * community profile is read for the pre-fill on that request and nowhere else.
 * Saving creates an independent row — later edits on either side leave the
 * other alone.
 */
export default async function CollaborationProfilePage({
  params,
  searchParams,
}: PageProps<"/collaboration/[slug]/profile">) {
  const { slug } = await params;
  const { start } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) notFound();
  if (!(await hasCollaborationAccess(collaboration.id))) redirect(`/collaboration/${slug}`);
  const t = translator(await getRequestLocale(collaboration));

  const persona = await getMyCollaborationPersona(collaboration.id, user.id);
  const onboarding = !persona;
  const points = onboarding ? await getPersonaStartingPoints(collaboration.id, user.id) : [];
  const chosen = typeof start === "string" ? points.find((point) => point.communityId === start) : undefined;

  const initial = persona
    ? { name: persona.name, bio: persona.bio }
    : chosen
      ? { name: chosen.displayName, bio: chosen.bio }
      : { name: "", bio: "" };

  return (
    <PageContainer width="narrow">
      {persona ? (
        <Link
          href={`/collaboration/${slug}`}
          className="mb-6 inline-flex items-center gap-1.5 rounded-[4px] text-[13px] text-ink-2 transition-colors hover:text-ink"
        >
          <IconArrowLeft size={14} />
          {collaboration.name}
        </Link>
      ) : null}

      <PageHeader
        eyebrow={collaboration.name}
        title={onboarding ? t("collab.profile.setupTitle") : t("collab.profile.editTitle")}
        lead={t("collab.profile.lead", { name: collaboration.name })}
      />

      {onboarding ? (
        <p role="status" className="mb-5 text-[13.5px] font-medium text-ink">
          {t("collab.profile.setupNotice")}
        </p>
      ) : null}

      {onboarding && points.length > 0 ? (
        <section className="mb-6">
          <p className="label mb-2">{t("collab.profile.startTitle")}</p>
          <ul className="flex flex-wrap gap-2">
            <li>
              <StartLink href={`/collaboration/${slug}/profile`} selected={!chosen}>
                {t("collab.profile.startBlank")}
              </StartLink>
            </li>
            {points.map((point) => (
              <li key={point.communityId}>
                <StartLink
                  href={`/collaboration/${slug}/profile?start=${encodeURIComponent(point.communityId)}`}
                  selected={chosen?.communityId === point.communityId}
                >
                  {t("collab.profile.startFrom", { name: point.communityName })}
                </StartLink>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
            {chosen
              ? t("collab.profile.startChosen", { name: chosen.communityName })
              : t("collab.profile.startHint")}
          </p>
        </section>
      ) : null}

      {/* Keyed on the starting point so choosing one resets the fields. */}
      <CollaborationProfileForm
        key={chosen?.communityId ?? "blank"}
        collaborationId={collaboration.id}
        slug={slug}
        userId={user.id}
        initialName={initial.name}
        initialBio={initial.bio}
        onboarding={onboarding}
      />
    </PageContainer>
  );
}

function StartLink({
  href,
  selected,
  children,
}: {
  href: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-[13px] transition-colors",
        selected
          ? "border-skog/40 bg-skog-soft/60 text-ink"
          : "border-line-2 bg-surface text-ink-2 hover:bg-paper-2",
      )}
    >
      {selected ? <IconCheck size={13} className="text-skog" /> : null}
      {children}
    </Link>
  );
}
