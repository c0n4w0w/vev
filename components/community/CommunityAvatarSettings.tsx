"use client";

import { useActionState, useRef, useState } from "react";
import { removeCommunityAvatarAction, setCommunityAvatarAction } from "@/app/actions";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import { Button, Panel } from "@/components/ui/primitives";
import { emptyCommentFormState } from "@/lib/comment-form";
import { AVATAR_ACCEPT, checkAvatarFileHint } from "@/lib/community-avatar-image";
import { useT } from "@/lib/i18n/react";
import type { Community } from "@/lib/types";

/**
 * Profilbilde: the community's image inside TING, for its administrator.
 *
 * One component for every community — nothing here knows which one it is
 * drawn for. It is only rendered for the administrator, but that is
 * presentation: the actions, the storage policies and the database function
 * behind them each refuse anyone else on their own.
 *
 * The file is checked in the browser purely so a wrong choice is answered
 * instantly. The server looks at the actual bytes again and is the authority.
 */
export function CommunityAvatarSettings({
  community,
}: {
  community: Pick<Community, "id" | "name" | "branding" | "avatarUrl">;
}) {
  const t = useT();
  const [uploadState, uploadAction, uploading] = useActionState(
    setCommunityAvatarAction,
    emptyCommentFormState,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeCommunityAvatarAction,
    emptyCommentFormState,
  );
  const [last, setLast] = useState<"upload" | "remove">("upload");
  const [clientError, setClientError] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = uploading || removing;
  const hasImage = Boolean(community.avatarUrl);
  const state = last === "remove" ? removeState : uploadState;

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
    setLast("upload");
    formRef.current?.requestSubmit();
  }

  const message = clientError
    ? { tone: "error" as const, text: clientError }
    : state.status === "error"
      ? { tone: "error" as const, text: state.message }
      : state.status === "ok"
        ? { tone: "ok" as const, text: state.message }
        : undefined;

  return (
    <Panel className="p-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <CommunityAvatar community={community} size="xl" className="self-start" />

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg text-ink">{t("avatar.title")}</h3>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-ink-2">
            {t("avatar.communityHelp")}
          </p>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-3">
            {t("avatar.communityFormats")}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <form ref={formRef} action={uploadAction} onSubmit={() => setLast("upload")}>
              <input type="hidden" name="communityId" value={community.id} />
              <input
                ref={fileRef}
                type="file"
                name="file"
                accept={AVATAR_ACCEPT}
                onChange={onFileChosen}
                className="sr-only"
                tabIndex={-1}
                aria-label={t("avatar.chooseImage")}
                disabled={busy}
              />
              <Button
                type="button"
                variant={hasImage ? "secondary" : "primary"}
                size="sm"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {uploading
                  ? t("common.uploading")
                  : hasImage
                    ? t("avatar.change")
                    : t("avatar.upload")}
              </Button>
            </form>

            {hasImage ? (
              <form action={removeAction} onSubmit={() => setLast("remove")}>
                <input type="hidden" name="communityId" value={community.id} />
                <Button type="submit" variant="quiet" size="sm" disabled={busy}>
                  {removing ? t("common.removing") : t("avatar.remove")}
                </Button>
              </form>
            ) : null}
          </div>

          {message ? (
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
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
