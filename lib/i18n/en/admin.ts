import type { admin as nb } from "../nb/admin";

export const admin: Record<keyof typeof nb, string> = {
  // ── Member administration ─────────────────────────────────────────────
  "admin.eyebrow": "Administration",
  "admin.members.metaTitle": "Members · Administration · {name}",
  "admin.members.adminsOnly":
    "It's the administrators of {name} who change access and moderator permissions. As a moderator, you follow up on conversations and content.",
  "admin.members.lead": "Manage access and moderator permissions in the community.",

  // ── Requests ──────────────────────────────────────────────────────────
  "requests.title": "Membership requests",
  "requests.adminsOnly":
    "It's the administrators of {name} who decide who gets in. As a moderator, you follow up on conversations and content.",
  "requests.lead":
    "People who have asked for access to {name} from the public page. If you approve, anyone who already has a TING account becomes a member immediately — everyone else gets an emailed link to sign in or create an account.",
  "requests.sent": "Sent {date}",
  "requests.reject": "Reject",
  "requests.rejectYes": "Yes, reject",
  "requests.approve": "Approve",
  "requests.expired": "Expired",
  "requests.expires": "Expires {when}",
  "requests.sentLower": "sent {date}",
  "requests.pending": "Pending",
  "requests.resend": "Resend",
  "requests.status.active": "Active member",
  "requests.status.awaitingLogin": "Waiting to sign in",
  "requests.status.linkExpired": "Link expired",
  "requests.status.rejected": "Rejected",
  "requests.reviewed": "Reviewed {date}",
  "requests.noneHeading": "No requests",
  "requests.waiting.one": "{count} request waiting",
  "requests.waiting.other": "{count} requests waiting",
  "requests.empty.title": "No pending requests",
  "requests.empty.body":
    "When someone asks for access from the public page, they show up here. If you approve, anyone who already has a TING account becomes a member immediately — everyone else gets an emailed link to sign in or create an account.",
  "requests.invitations": "Sent invitations",
  "requests.noInvitations": "No invitations are waiting to be used.",
  "requests.invitationNote":
    "An invitation is valid for one email address, one community and a single use. If you resend it, the previous link stops working.",
  "requests.recent": "Recently reviewed",

  // ── Account links ─────────────────────────────────────────────────────
  "links.title": "Account links",
  "links.adminsOnly":
    "It's the administrators of {name} who link public organization contacts to TING accounts.",
  "links.lead":
    "Link public organization contacts to existing TING accounts for features like direct messages.",
  "links.backTo": "Back to {target}",
  "links.unlinked": "Not linked",
  "links.allLinked": "All organization contacts are linked.",
  "links.linked": "Linked",
  "links.noneLinked": "No organization contacts are linked yet.",
  "links.accountFor": "TING account for {name}",
  "links.chooseMember": "Choose an active member",
  "links.linkedTo": "Linked to",
  "links.tingAccount": "TING account",
  "links.inactive": "The linked account isn't active in this community",
  "links.switch": "Switch account",
  "links.link": "Link account",
  "links.saveSwitch": "Save change",
  "links.submitLink": "Link",
  "links.remove": "Remove link",

  // ── Emojis ────────────────────────────────────────────────────────────
  "emoji.title": "Emojis",
  "emoji.lead":
    "Custom emojis for {name}. They exist only here — another community can neither see nor use them, and two communities can safely each have their own :party:.",
  "emoji.addTitle": "Add an emoji",
  "emoji.addHelp":
    "PNG, GIF or WebP, max {size}×{size} pixels and 256 KB. The emoji is visible only to members of this community.",
  "emoji.name": "Name",
  "emoji.namePlaceholder": "emoji-name",
  "emoji.image": "Image",
  "emoji.add": "Add",
  "emoji.willBe": "Will be available as",
  "emoji.count.one": "{count} custom emoji",
  "emoji.count.other": "{count} custom emojis",
  "emoji.empty.title": "No custom emojis yet",
  "emoji.empty.manage":
    "Add the first one above. It's immediately available in the reaction picker for every member here.",
  "emoji.empty.readonly": "Moderators and administrators can add emojis for this community.",
  "emoji.addedBy": "Added by {name} · {date}",
  "emoji.aMember": "a member",

  // ── Settings ──────────────────────────────────────────────────────────
  "settings.title": "Settings",
  "settings.none.title": "No settings for you here yet",
  "settings.none.body":
    "The settings on this page are for administrators and moderators of {name}.",
  "settings.lead.admin": "The community's profile and your own choices in {name}.",
  "settings.lead.staff": "Your own choices in {name}. They apply only to you, and only here.",
  "settings.communityProfile": "Community profile",
  "settings.directMessages": "Direct messages",
  "settings.dm.staffOnly":
    "{name} has turned off direct messages between members. By default, members can't write to administrators and moderators either — each of us chooses whether to be available.",
  "settings.dm.open":
    "{name} lets members send each other direct messages. That means you're already available to members here, and there's nothing to switch on.",
  "settings.dm.toggle": "Allow messages from members",
  "settings.dm.toggleHelp":
    "When this is on, members of this community can start a direct message with you.",
  "settings.dm.scope":
    "This setting applies only to {name}. If you're in several communities, you control each one separately.",

  // ── Community picture and personal profile ────────────────────────────
  "avatar.title": "Profile picture",
  "avatar.communityHelp": "This image is used as the community's profile picture inside TING.",
  "avatar.communityFormats":
    "PNG, JPEG or WebP, max 5 MB. Shown as a square, and cropped if the image isn't square.",
  "avatar.chooseImage": "Choose image",
  "avatar.change": "Change image",
  "avatar.upload": "Upload image",
  "avatar.remove": "Remove image",
  "profile.metaTitle": "Your profile · {name}",
  "profile.account": "Your account",
  "profile.title": "Your profile here",
  "profile.lead":
    "This is how you appear to others in {name}. Changes here don't affect your profiles in other communities.",
  "profile.photoHelp": "Shown only in {name}. Without a photo, your initials are shown.",
  "profile.photoFormats":
    "PNG, JPEG or WebP, max 5 MB. Shown as a circle, and cropped if the image isn't square.",
  "profile.choosePhoto": "Choose profile picture",
  "profile.displayName": "Display name",
  "profile.displayNameHelp":
    "Your own name or a pseudonym. Other members of {name} see this name.",
  "profile.bio": "Bio",
  "profile.bioPlaceholder":
    "Optional. A couple of sentences about you, the way you'd like to introduce yourself here.",
  "profile.saveChanges": "Save changes",
};
