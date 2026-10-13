import type { errors as nb } from "../nb/errors";

export const errors: Record<keyof typeof nb, string> = {
  // ── Messages and posts ────────────────────────────────────────────────
  "err.messageEmpty": "The message can't be empty.",
  "err.messageTooLong": "The message can be at most 4,000 characters.",
  "err.messageLength": "The message must be between 1 and 4,000 characters.",
  "err.channelWriteDenied": "You don't have access to write in this channel.",
  "err.conversationWriteDenied": "You don't have access to write in this conversation.",
  "err.messageSendFailed": "The message couldn't be sent. Try again.",
  "err.conversationOpenFailed": "The conversation couldn't be opened. Try again.",
  "err.attachmentNotAllowed": "You can't attach files in this conversation.",
  "err.attachmentNeedsMutual":
    "File sharing unlocks once you have both sent at least one text message in this conversation.",
  "err.attachmentArchived": "This conversation is archived. New files can't be attached.",
  "err.attachmentTooLarge": "{name} is too large. Files can be at most {max} MB here.",
  "err.attachmentTooMany": "You can attach at most {max} files to one message.",
  "err.attachmentTooManySent": "The message has too many attachments. Remove some and try again.",
  "err.attachmentType":
    "{name} is in a format that isn't supported. You can send images (JPG, PNG, WebP, GIF), PDF, DOCX, XLSX, PPTX, TXT, CSV and audio (MP3, WAV, M4A).",
  "err.attachmentEmpty": "{name} is empty.",
  "err.attachmentUploadFailed": "{name} couldn't be uploaded. Try again.",
  "err.attachmentInvalid":
    "The attachments couldn't be sent. Remove them, upload them again and try once more.",
  "err.attachmentStillUploading": "Wait until the files have finished uploading.",
  "err.attachmentFailedPresent":
    "One of the files couldn't be uploaded. Remove it or try again before sending.",
  "err.postEmpty": "The post can't be empty.",
  "err.postEditOwn": "You can only edit your own posts.",
  "err.postDeleteDenied": "You don't have access to delete this post.",
  "err.pinDenied": "You don't have access to pin posts here.",
  "err.publishDenied": "Only admins and moderators can publish to the feed.",
  "err.postSaveFailed": "The post couldn't be saved. Try again.",
  "err.commentEmpty": "The comment can't be empty.",
  "err.commentEditOwn": "You can only edit your own comments.",
  "err.commentDeleteDenied": "You don't have access to delete this comment.",
  "err.commentDenied": "You don't have access to comment here.",
  "err.replyToReply": "You can't reply to a reply.",
  "err.commentSaveFailed": "The comment couldn't be saved. Try again.",
  "err.reactionInvalid": "Invalid reaction.",
  "err.reactionRemoveFailed": "The reaction couldn't be removed.",
  "err.reactionDenied": "You don't have access to react here.",
  "err.reactionOtherCommunity": "This emoji belongs to another community.",
  "err.reactionSaveFailed": "The reaction couldn't be saved.",

  // ── Emojis, images, profiles ──────────────────────────────────────────
  "err.emojiExists": ":{name}: already exists in this community.",
  "err.emojiAddDenied": "You don't have access to add emojis here.",
  "err.emojiSaveFailed": "The emoji couldn't be saved.",
  "err.emojiDeleteDenied": "You don't have access to delete this emoji.",
  "err.emojiDeleteFailed": "The emoji couldn't be deleted.",
  "err.emojiImageRemoveFailed": "The emoji image couldn't be removed. Try again.",
  "err.emojiName":
    "The name must be 2–32 characters: lowercase letters, numbers, hyphens or underscores.",
  "err.imageUploadFailed": "The image couldn't be uploaded.",
  "err.imageUploadRetry": "The image couldn't be uploaded. Try again.",
  "err.chooseFile": "Choose an image file.",
  "err.fileEmpty": "The file is empty.",
  "err.fileTooLarge": "The file is larger than {kb} KB.",
  "err.imageFileIncomplete": "The {format} file is incomplete.",
  "err.webpVariant": "This WebP variant isn't supported.",
  "err.imageSizeUnreadable": "Couldn't read the image size.",
  "err.emojiFormat": "The file must be PNG, GIF or WebP.",
  "err.imageTooLarge": "The image is {width}×{height}. Maximum {max}×{max} pixels.",
  "err.emojiTooSmall": "The image is too small. At least {min} pixels.",
  "err.avatarFormat": "The image must be PNG, JPEG or WebP.",
  "err.avatarTooBig": "The image is too large. Maximum {max} MB.",
  "err.avatarIncomplete": "The image file is incomplete.",
  "err.avatarUnreadable": "Couldn't read the image. Try another file.",
  "err.avatarTooSmall": "The image is too small. At least {min} pixels on each side.",
  "err.avatarAdminOnly": "Only the administrator can change the community's profile picture.",
  "err.avatarSaveFailed": "The profile picture couldn't be saved.",
  "err.communityAboutTooLong": "The description is too long. Maximum {max} characters.",
  "err.channelNameEmpty": "The channel name can't be empty.",
  "err.channelNameTooLong": "The channel name can be at most {max} characters.",
  "err.channelPurposeTooLong": "The description can be at most {max} characters.",
  "err.channelEditFailed": "Could not save the changes. Only administrators can edit the channel.",
  "err.channelArchived": "This channel is archived. Nobody can post here.",
  "err.privateChannelNameTaken": "There is already a private channel with this name in the local group.",
  "err.privateChannelParticipantIneligible":
    "One of the participants is no longer an active member of the local group. Remove them from the selection and try again.",
  "err.privateChannelCreateRefused":
    "The channel wasn't created. Only administrators and the local group's leaders can create private channels.",
  "err.privateChannelAddRefused":
    "The participant wasn't added. They may already be in the channel, not be an active member of the local group, or you aren't allowed to change this channel.",
  "err.privateChannelRemoveRefused": "The participant wasn't removed. You aren't allowed to change this channel.",
  "err.privateChannelManagerRefused":
    "The change wasn't saved. Only administrators can choose channel managers, and only the local group's leaders can be one.",
  "err.privateChannelArchiveRefused": "The channel wasn't changed. You aren't allowed to manage this channel.",
  "err.privateChannelDeleteRefused":
    "The channel wasn't deleted. Only administrators and channel managers can delete a private channel.",
  "err.communityAboutSaveFailed": "Could not save the changes. Try again.",
  "ok.communityAboutSaved": "Changes saved.",
  "err.profileSaveFailed": "The profile couldn't be saved. Try again.",
  "err.profileOwnOnly":
    "You can only edit your own profile in communities where you're an active member.",
  "err.profileInactive":
    "You can only edit your profile in communities where you're an active member.",
  "err.nameEmpty": "Enter the name or pseudonym you'd like to use.",
  "err.nameTooLong": "The name can't be longer than {max} characters.",
  "err.bioTooLong": "The bio can't be longer than {max} characters.",
  "ok.avatarUpdated": "Profile picture updated.",
  "ok.avatarRemoved": "Profile picture removed.",
  "ok.avatarRemovedInitials": "Profile picture removed. Your initials are shown again.",
  "ok.profileSaved": "Profile saved.",

  // ── Events and local groups ───────────────────────────────────────────
  "err.eventFull": "This event is full. There are no spots left right now.",
  "err.rsvpRefused": "Your sign-up couldn't be saved. Try again.",
  "err.eventCreateRefused":
    "The event wasn't created. Only administrators, and lokallag leaders for their own lokallag, can add events.",
  "err.eventEditRefused":
    "The change wasn't saved. Only administrators, and lokallag leaders for their own lokallag, can edit events.",
  "err.eventCapacityBelowAttendees": "Capacity can't be lower than the number signed up ({count}).",
  "err.eventManageRefused":
    "That wasn't done. Only administrators, and lokallag leaders for their own lokallag, can cancel or restore events.",
  "err.eventAlreadyCancelled": "The event is already cancelled.",
  "err.eventNotCancelled": "The event isn't cancelled.",
  "err.eventAlreadyEnded": "The event has already taken place.",
  "err.eventRestoreOverCapacity":
    "The event can't be restored because more people are signed up than there are places. Increase the capacity first.",
  "err.eventDeleteRefused":
    "The event wasn't deleted. Only administrators of the community can permanently delete events.",
  "err.eventDeleteUnconfirmed": "Confirm that you understand the deletion can't be undone.",
  "err.attendeeRemoveRefused":
    "The registration wasn't removed. Only administrators, and lokallag leaders for their own lokallag, can remove registrations.",
  "err.attendeeRemoveCancelled": "The event is cancelled, and its registrations are kept as history.",
  "err.attendeeRemoveNotAttending": "That person is no longer signed up.",
  "err.eventTitleRequired": "The event needs a title.",
  "err.eventTitleTooLong": "The title can be at most 120 characters.",
  "err.eventLocationRequired": "Enter a location.",
  "err.eventLocationTooLong": "The location can be at most 120 characters.",
  "err.eventDescriptionTooLong": "The description can be at most 4,000 characters.",
  "err.eventDatesRequired": "Fill in the date, start and end.",
  "err.eventDatesUnreadable": "The date or time couldn't be read.",
  "err.eventEndsBeforeStart": "The event has to end after it begins.",
  "err.eventCapacityInvalid": "Spots must be a whole number, or left empty.",
  "err.localGroupSelectionRefused":
    "That local group couldn't be selected. It may have been retired, or belong to another community.",
  "err.localGroupAdminRefused":
    "The change wasn't made. Only administrators of this community can edit local groups.",
  "err.localGroupLeaderPick": "Choose a member first.",
  "err.localGroupLeaderAddRefused":
    "The leader wasn't appointed. Only administrators can appoint local group leaders, and only active members of this local group can be appointed.",
  "err.localGroupLeaderRemoveRefused":
    "The leader wasn't removed. Only administrators can remove local group leaders, or the person had already been removed.",
  "err.eventScopedNotPublic":
    "An event for a local group or a team can't be open to the public. Untick the public option, or choose the whole community.",
  "err.subgroupPickMember": "Choose a member to add.",
  "err.subgroupAddRefused":
    "The member wasn't added. They may already be in the group, not be an active member, or you aren't allowed to change this group.",
  "err.subgroupRemoveRefused":
    "The member wasn't removed. You aren't allowed to change this team, or the person is a team manager and can only be removed by an administrator.",
  "err.subgroupNameEmpty": "The team needs a name.",
  "err.subgroupNameTooLong": "The team name can be at most {max} characters.",
  "err.subgroupDescriptionTooLong": "The description can be at most {max} characters.",
  "err.subgroupMemberIneligible":
    "One of the selected people is no longer an active member of the community. Remove them from the selection and try again.",
  "err.subgroupCreateRefused":
    "The team wasn't created. Only administrators and moderators can create teams.",
  "err.subgroupEditRefused": "The changes weren't saved. You aren't allowed to manage this team.",
  "err.subgroupManagerRefused":
    "The change wasn't saved. Only administrators choose team managers, and only members of the team can be one.",
  "err.subgroupArchiveRefused": "The team wasn't changed. You aren't allowed to manage this team.",
  "err.subgroupDeleteRefused":
    "The team wasn't deleted. Only administrators and team managers can delete a team.",
  "err.subgroupDeleteHasContent":
    "The team wasn't deleted because posts or events have been published to it. Delete them first, or archive the team.",
  "err.localGroupNameRequired": "The local group needs a name.",

  // ── Settings, requests and invitations ────────────────────────────────
  "err.dmSettingFailed":
    "The setting couldn't be changed. Only administrators and moderators can change it.",
  "err.emailInvalid": "Enter a valid email address.",
  "err.requestFailed": "We couldn't send your request. Check your details and try again.",
  "ok.requestSent": "Thank you. Your request has been sent to an administrator.",
  "err.approveFailed": "The request couldn't be approved.",
  "ok.approvedActivatedSent":
    "Approved. {email} already had a TING account, so access is active right away. A welcome email with a sign-in link has been sent.",
  "ok.approvedActivatedMailFailed":
    "Approved. {email} already had a TING account, so access is active – but the welcome email couldn't be sent.",
  "ok.approvedAlready": "The request was already approved. The sign-in link is still valid.",
  "ok.approvedSent": "Approved. A sign-in link has been sent to {email}.",
  "ok.rejected": "The request was rejected.",
  "err.rejectFailed": "The request couldn't be rejected.",
  "err.resendFailed": "The invitation couldn't be resent.",
  "ok.resent": "New invitation sent to {email}.",
  "err.noInvitation": "There's no invitation to send.",
  "err.emailNotSent": "The invitation was created, but the email couldn't be sent: {error}",
  "err.email.temporary":
    "The mail service didn't answer, or asked us to try again later. Resend the invitation in a little while.",
  "err.email.rejected":
    "The mail service refused the message or the recipient's address. Check the address before resending.",
  "err.email.configuration":
    "Sending email isn't set up correctly on this installation. Contact whoever runs TING, then resend the invitation.",
  "err.email.uncertain":
    "The connection dropped while the email was being sent, so it may or may not have arrived. Ask the recipient before sending another – a new invitation cancels the previous one.",
  "err.invitation.mismatch":
    "This invitation was sent to a different email address than the one you're signed in with. Sign in with the address the invitation was sent to.",
  "err.invitation.used": "This invitation has already been used.",
  "err.invitation.expired": "This invitation has expired. Ask an administrator to send a new one.",
  "err.invitation.revoked":
    "This invitation has been replaced by a newer one. Use the most recent link you received.",
  "err.invitation.invalid": "This invitation isn't valid.",
  "err.authUnavailable": "We can't reach sign-in right now. The link hasn't been used up – try again in a moment.",
  "err.notificationsFailed": "Notifications couldn't be marked as read. Try again.",
};
