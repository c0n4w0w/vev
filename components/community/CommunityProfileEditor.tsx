"use client";

import { useActionState, useRef, useState } from "react";
import {
  removeMyCommunityAvatarAction,
  setMyCommunityAvatarAction,
  updateCommunityProfileAction,
} from "@/app/actions";
import { Avatar, Button, Panel } from "@/components/ui/primitives";
import { DISPLAY_NAME_MAX } from "@/lib/access-form";
import { AVATAR_ACCEPT, checkAvatarFileHint } from "@/lib/community-avatar-image";
import {
  BIO_MAX,
  emptyCommunityProfileFormState,
  type CommunityProfileFormState,
} from "@/lib/community-profile-form";
import { useT } from "@/lib/i18n/react";
import type { CommunityPersona } from "@/lib/types";

const field =
  "h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";

function Feedback({ state, clientError }: { state: CommunityProfileFormState; clientError?: string }) {
  const message = clientError
    ? { tone: "error" as const, text: clientError }
    : state.status === "error"
      ? { tone: "error" as const, text: state.message }
      : state.status === "ok"
        ? { tone: "ok" as const, text: state.message }
        : undefined;
  if (!message?.text) return null;
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={
        message.tone === "error"
          ? "mt-3 rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] text-rust"
          : "mt-3 text-[13px] text-skog"
      }
    >
      {message.text}
    </p>
  );
}

/**
 * Editing how you appear in one community: photo, display name, bio.
 *
 * Only ever the signed-in person's own profile, and only this community's —
 * there is no field naming a person, and nothing here touches the account or
 * another community. The file check in the browser only answers quickly; the
 * server reads the bytes again and the database decides.
 */
export function CommunityProfileEditor({
  persona,
  communityName,
}: {
  persona: CommunityPersona;
  communityName: string;
}) {
  const t = useT();
  const [profileState, profileAction, saving] = useActionState(
    updateCommunityProfileAction,
    emptyCommunityProfileFormState,
  );
  const [uploadState, uploadAction, uploading] = useActionState(
    setMyCommunityAvatarAction,
    emptyCommunityProfileFormState,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeMyCommunityAvatarAction,
    emptyCommunityProfileFormState,
  );
  const [lastPhoto, setLastPhoto] = useState<"upload" | "remove">("upload");
  const [clientError, setClientError] = useState<string>();
  const [bioLength, setBioLength] = useState(Array.from(persona.bio).length);
  const photoFormRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const photoBusy = uploading || removing;
  const hasPhoto = Boolean(persona.avatarUrl);

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const problem = checkAvatarFileHint(file, t);
    if (problem) {
      setClientError(problem);
      event.target.value = "";
      return;
    }
    setClientError(undefined);
    setLastPhoto("upload");
    photoFormRef.current?.requestSubmit();
  }

  return (
    <div className="space-y-6">
      <Panel className="p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar user={persona} size="xl" className="self-start" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg text-ink">{t("avatar.title")}</h2>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-ink-2">
              {t("profile.photoHelp", { name: communityName })}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <form ref={photoFormRef} action={uploadAction} onSubmit={() => setLastPhoto("upload")}>
                <input type="hidden" name="communityId" value={persona.communityId} />
                <input
                  ref={fileRef}
                  type="file"
                  name="file"
                  accept={AVATAR_ACCEPT}
                  onChange={onFileChosen}
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={t("profile.choosePhoto")}
                  disabled={photoBusy}
                />
                <Button
                  type="button"
                  variant={hasPhoto ? "secondary" : "primary"}
                  size="sm"
                  disabled={photoBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading
                    ? t("common.uploading")
                    : hasPhoto
                      ? t("avatar.change")
                      : t("avatar.upload")}
                </Button>
              </form>

              {hasPhoto ? (
                <form action={removeAction} onSubmit={() => setLastPhoto("remove")}>
                  <input type="hidden" name="communityId" value={persona.communityId} />
                  <Button type="submit" variant="quiet" size="sm" disabled={photoBusy}>
                    {removing ? t("common.removing") : t("avatar.remove")}
                  </Button>
                </form>
              ) : null}
            </div>

            <Feedback
              state={lastPhoto === "remove" ? removeState : uploadState}
              clientError={clientError}
            />
          </div>
        </div>
      </Panel>

      <Panel className="p-5">
        <form action={profileAction} className="space-y-5">
          <input type="hidden" name="communityId" value={persona.communityId} />

          <div>
            <label htmlFor="profile-display-name" className="label mb-1.5 block">
              {t("profile.displayName")}
            </label>
            <input
              id="profile-display-name"
              name="displayName"
              required
              maxLength={DISPLAY_NAME_MAX}
              defaultValue={persona.name}
              autoComplete="off"
              className={field}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
              {t("profile.displayNameHelp", { name: communityName })}
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label htmlFor="profile-bio" className="label block">
                {t("profile.bio")}
              </label>
              <span className="text-[11px] tabular-nums text-ink-3">
                {bioLength}/{BIO_MAX}
              </span>
            </div>
            <textarea
              id="profile-bio"
              name="bio"
              rows={4}
              maxLength={BIO_MAX}
              defaultValue={persona.bio}
              onChange={(event) => setBioLength(Array.from(event.target.value).length)}
              placeholder={t("profile.bioPlaceholder")}
              className="w-full rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? t("common.saving") : t("profile.saveChanges")}
            </Button>
          </div>
          <Feedback state={profileState} />
        </form>
      </Panel>
    </div>
  );
}
