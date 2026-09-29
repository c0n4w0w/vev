import type { collaboration as nb } from "../nb/collaboration";

export const collaboration: Record<keyof typeof nb, string> = {
  // ── Hub ───────────────────────────────────────────────────────────────
  "collab.hub.metaTitle": "Collaborations",
  "collab.hub.eyebrow": "Collaborations",
  "collab.hub.title": "Collaboration across organizations",
  "collab.hub.lead":
    "Private workspaces where several organizations plan something together. Each organization chooses which of its own people take part.",
  "collab.hub.new": "New collaboration",
  "collab.hub.yours": "Your collaborations",
  "collab.hub.orgInvites": "Invitations to your organization",
  "collab.hub.personInvites": "Invitations to you",
  "collab.hub.managed": "Collaborations you manage",
  "collab.hub.managedLead":
    "You represent your organization here, but you're not on the organizer team yourself.",
  "collab.hub.empty.title": "No collaborations yet",
  "collab.hub.empty.body":
    "When your organization is invited to a collaboration, or someone picks you as an organizer, it shows up here.",
  "collab.hub.empty.admin":
    "When your organization is invited to a collaboration, or someone picks you as an organizer, it shows up here. As an administrator you can also start one.",

  "collab.private": "Private collaboration",
  "collab.role.organizer": "Organizer",
  "collab.role.manager": "Manager",
  "collab.enterWorkspace": "Enter organizer workspace",
  "collab.manage": "Manage collaboration",
  "collab.back": "Collaborations",

  // ── Create ────────────────────────────────────────────────────────────
  "collab.new.metaTitle": "New collaboration",
  "collab.new.title": "Start a collaboration",
  "collab.new.lead":
    "A private workspace for the organizers from the organizations taking part. The public doesn't belong here.",
  "collab.new.name": "Name",
  "collab.new.namePlaceholder": "E.g. Seminar on the drug market",
  "collab.new.description": "Description",
  "collab.new.optional": "optional",
  "collab.new.descriptionPlaceholder": "What will you achieve together?",
  "collab.new.unit": "On behalf of",
  "collab.new.unitHint":
    "The units you can represent. Choosing a local group doesn't make you a member of it.",
  "collab.new.wholeOrg": "{name} – whole organization",
  "collab.new.submit": "Create collaboration",
  "collab.new.notAllowed.title": "Collaborations are started by an organization",
  "collab.new.notAllowed.body":
    "An organization's administrator can start a collaboration on its behalf, or on behalf of one of its local groups.",

  // ── Organisation invitations ──────────────────────────────────────────
  "collab.orgInvite.title": "{name} has been invited to collaborate",
  "collab.orgInvite.with": "Already taking part: {names}",
  "collab.orgInvite.participateAs": "Participate as",
  "collab.orgInvite.wholeOrg": "All of {name}",
  "collab.orgInvite.note":
    "Accepting makes your organization a participant. It doesn't put anyone on the organizer team — you choose that afterwards, from your own people.",
  "collab.orgInvite.accept": "Accept",
  "collab.orgInvite.decline": "Decline",
  "collab.orgInvite.declineNote": "Your organization won't take part. The collaboration can invite you again later.",
  "collab.orgInvite.declineConfirm": "Yes, decline",
  "collab.orgInvite.acceptedUnit": "{unit} is now taking part in the collaboration.",
  "collab.orgInvite.acceptedNotTeam": "You are not automatically on the organizer team. Choose organizers from your own people below.",
  "collab.orgInvite.acceptedOnTeam": "You are also on the organizer team, because you belong to this unit yourself.",
  "collab.orgInvite.declined": "The invitation was declined.",
  "collab.orgInvite.acceptFailed":
    "Couldn't accept. The invitation may already have been answered, or that unit is already taking part.",
  "collab.orgInvite.pending": "{name} has been invited. An administrator there must respond.",

  // ── Invitations to a person ───────────────────────────────────────────
  "collab.personInvite.title": "You've been invited to join the organizer team",
  "collab.personInvite.via": "Invited through",
  "collab.personInvite.note":
    "You choose how you appear in the collaboration. None of your profiles are shared automatically.",
  "collab.personInvite.accept": "Accept and join",
  "collab.personInvite.decline": "Decline",
  "collab.personInvite.declineNote": "You won't join the organizer team. Your organization will see that you declined, and can invite you again later.",
  "collab.personInvite.declineConfirm": "Yes, decline",
  "collab.personInvite.acceptFailed": "Couldn't join. The invitation may no longer be valid.",
  "collab.personInvite.declined": "You declined.",
  "collab.rejoin.title": "You left the organizer team",
  "collab.rejoin.body": "You can rejoin as long as your organization still has you selected.",
  "collab.rejoin.action": "Rejoin",

  // ── The collaboration ─────────────────────────────────────────────────
  "collab.page.about": "About",
  "collab.page.participating": "Participating organizations",
  "collab.page.you": "you",
  "collab.page.yourProfile": "Your profile here",
  "collab.page.managerNotice":
    "You represent {unit} in this collaboration, but you're not part of the organizer team.",
  "collab.page.managerNoticeBody":
    "You can invite organizations, choose organizers from the people in your own unit, and withdraw it. The organizer workspace is for people on the team.",
  "collab.page.leave": "Leave organizer team",
  "collab.page.leaveConfirm": "Yes, leave",
  "collab.page.leaveNote":
    "You only leave the organizer team. Your membership of your organization isn't affected.",

  // ── Management ────────────────────────────────────────────────────────
  "collab.manage.title": "Management",
  "collab.manage.lead":
    "The organizations taking part, and what you can do for your own. Other organizations' people are never shown here.",
  "collab.manage.invited": "Awaiting a reply",
  "collab.manage.inviteTitle": "Invite an organization",
  "collab.manage.inviteHint":
    "Enter the organization's TING address, for example {example}. TING has no directory of organizations, so you need to know the address.",
  "collab.manage.inviteExample": "organization-address",
  "collab.manage.inviteLabel": "TING address",
  "collab.manage.inviteSubmit": "Invite",
  "collab.invite.failed":
    "No organization could be invited at that address. Check it's spelled correctly and that the organization hasn't already been invited.",
  "collab.invite.sent": "{name} has been invited. An administrator there must respond.",
  "collab.unit.yours": "Your unit",
  "collab.unit.chooseOrganizers": "Choose organizers",
  "collab.unit.withdraw": "Withdraw unit",
  "collab.unit.withdrawConfirm": "Yes, withdraw",
  "collab.unit.withdrawNote":
    "The organizers you chose lose access. Your organization and its memberships aren't affected.",
  "collab.requests.title": "Public listing as organizer",
  "collab.requests.lead":
    "The collaboration asks to show your unit as an organizer on a public event page. That only happens if you approve, and you can withdraw your approval at any time.",
  "collab.requests.approve": "Approve public listing",
  "collab.requests.revoke": "Withdraw approval",
  "collab.requests.revokeNote": "Your unit is removed from the public page immediately.",
  "collab.requests.revokeConfirm": "Yes, withdraw",
  "collab.requests.pending": "Not approved. Your unit is not shown publicly.",
  "collab.requests.approved": "Approved. Shown the next time the event is published or updated.",
  "collab.requests.listed": "Approved and shown on the public page now.",
  "collab.requests.approvedMsg": "Approved.",
  "collab.requests.revokedMsg": "Approval withdrawn.",
  "collab.unit.withdrawn": "The unit has been withdrawn from the collaboration.",

  // ── Choosing organisers ───────────────────────────────────────────────
  "collab.organizers.metaTitle": "Choose organizers · {name}",
  "collab.organizers.title": "Choose organizers from {unit}",
  "collab.organizers.lead":
    "Only people in {unit} are shown here. The other organizations can't see this list, and anyone you choose has to accept themselves.",
  "collab.organizers.empty": "No active members in this unit.",
  "collab.organizers.status.none": "Not invited",
  "collab.organizers.status.invited": "Invited",
  "collab.organizers.status.joined": "On the team",
  "collab.organizers.status.left": "Left the team",
  "collab.organizers.status.accepted": "Accepted",
  "collab.organizers.status.declined": "Declined",
  "collab.organizers.status.revoked": "Revoked",
  "collab.organizers.invite": "Invite",
  "collab.organizers.reinvite": "Invite again",
  "collab.organizers.revoke": "Revoke",
  "collab.organizers.revokeNote": "They lose their place on the organizer team. Their membership of your organization isn't affected.",
  "collab.organizers.revokeConfirm": "Yes, revoke",
  "collab.organizers.inviteFailed":
    "Couldn't invite. The person may no longer belong to this unit.",
  "collab.organizers.you": "you",

  // ── Collaboration persona ─────────────────────────────────────────────
  "collab.profile.metaTitle": "Your profile · {name}",
  "collab.profile.setupTitle": "How do you want to appear here?",
  "collab.profile.editTitle": "Your profile in this collaboration",
  "collab.profile.lead":
    "This profile only applies in {name}. It's separate from your profiles in your organizations, and changes here don't affect them.",
  "collab.profile.setupNotice": "Set up your collaboration profile to continue.",
  "collab.profile.startTitle": "Starting point",
  "collab.profile.startFrom": "Start with my profile from {name}",
  "collab.profile.startBlank": "Start blank",
  "collab.profile.startHint":
    "A starting point is copied once. After that the profiles are independent of each other.",
  "collab.profile.startChosen":
    "Filled in from your profile in {name}. Nothing is saved until you press save.",
  "collab.profile.displayName": "Display name",
  "collab.profile.displayNameHelp":
    "The name the other organizers see. Your own, or one you choose for the occasion.",
  "collab.profile.bio": "About you",
  "collab.profile.bioPlaceholder": "What do you bring to the collaboration?",
  "collab.profile.saveFirst": "Save and continue",
  "collab.profile.saveFailed": "Couldn't save the profile. Do you still have access to the collaboration?",

  // ── Errors ────────────────────────────────────────────────────────────
  "collab.err.nameRequired": "Give the collaboration a name.",
  "collab.err.nameTooLong": "The name can't be longer than {max} characters.",
  "collab.err.descriptionTooLong": "The description can't be longer than {max} characters.",
  "collab.err.chooseUnit": "Choose who you're creating the collaboration on behalf of.",
  "collab.err.createRefused":
    "The collaboration couldn't be created. You must be an administrator of the unit you choose.",
  "collab.err.refused": "That didn't work. You may no longer be allowed to do this.",
};
