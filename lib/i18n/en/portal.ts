import type { portal as nb } from "../nb/portal";

export const portal: Record<keyof typeof nb, string> = {
  // ── Portal: header and hero ───────────────────────────────────────────
  "utr.header.open": "Open the community",
  "utr.header.signedInAs": "Signed in as {name}",
  "utr.header.login": "Log in",
  "utr.newTab": "(opens in a new tab)",
  "utr.hero.eyebrow": "— The community around Under The Rug",
  "utr.hero.line1": "{name} continues",
  "utr.hero.line2": "between the events.",
  "utr.hero.p1":
    "A digital space for the people around UTR — artists, musicians, volunteers, collaborators and anyone who just wants to be closer to what's happening.",
  "utr.hero.p2":
    "Find smaller events, new projects, people to make things with, and things that haven't been announced yet.",
  "utr.hero.cta": "Join the community",
  "utr.hero.nextEvent": "Next open night",
  "utr.hero.photoAlt":
    "Two musicians play beneath a large canvas projection in a dark industrial space.",

  // ── Portal: right now ─────────────────────────────────────────────────
  "utr.now.title1": "Right now in",
  "utr.now.title2": "the community",
  "utr.now.lede": "A small glimpse of what might turn up inside.",
  "utr.now.note": "The conversations themselves are only visible to people in the community.",
  "utr.now.listLabel": "Examples of posts in the community",
  "utr.glimpse1.category": "Projects",
  "utr.glimpse1.text": "Looking for someone to build an installation with in October.",
  "utr.glimpse1.meta": "Ines · 4 replies",
  "utr.glimpse2.category": "Visuals",
  "utr.glimpse2.text": "João is sharing the visual system from the last UTR.",
  "utr.glimpse2.meta": "18 files",
  "utr.glimpse2.photoAlt":
    "A blue projected eye above the stage, with a laser beam cutting diagonally through the room.",
  "utr.glimpse3.category": "Listening session",
  "utr.glimpse3.text": "Listening session on Thursday — 12 spots.",
  "utr.glimpse3.meta": "Thu 19:00 · 9 of 12 taken",

  // ── Portal: why join ──────────────────────────────────────────────────
  "utr.why.eyebrow": "— Why join?",
  "utr.why.line1": "Don't just follow along.",
  "utr.why.line2": "Take part.",
  "utr.reason1.title": "Discover what happens between the big nights.",
  "utr.reason1.body":
    "Small concerts, listening sessions, workshops, dinners, working meetings and spontaneous things that don't necessarily end up on the public page.",
  "utr.reason2.title": "Find the people behind and around UTR.",
  "utr.reason2.body":
    "Musicians, artists, designers, technicians, volunteers and other curious people in the scene.",
  "utr.reason3.title": "Start something.",
  "utr.reason3.body":
    "Share an idea, find someone to collaborate with, ask for help or join a project that's already under way.",
  "utr.reason4.title": "Get closer to the process.",
  "utr.reason4.body":
    "Follow things as they take shape — new venues, artists, installations, collaborations and experiments before they become finished programmes.",
  "utr.candlePhotoAlt":
    "A tent, rugs and lit candles on the floor of a dark room, set up for a small gathering.",

  // ── Portal: public and private ────────────────────────────────────────
  "utr.inside.line1": "Some things are open to everyone.",
  "utr.inside.line2": "The rest happens inside.",
  "utr.inside.body":
    "On this page you'll find open events. Inside the community you'll find the conversations, smaller gatherings, the projects and the people around Under The Rug.",

  // ── Portal: public events ─────────────────────────────────────────────
  "utr.events.eyebrow": "— Open to everyone",
  "utr.events.title": "Upcoming open events",
  "utr.events.none": "Nothing announced right now.",
  "utr.events.noneNote": "New open events appear here as soon as they're ready.",
  "utr.events.time": "Time",
  "utr.events.place": "Place",

  // ── Portal: access ────────────────────────────────────────────────────
  "utr.access.titlePre": "Want to ",
  "utr.access.titleEm": "join?",
  "utr.access.photoAlt":
    "A performer leans over a table of equipment in front of a green projection.",
  "utr.access.p1":
    "The community is for people who want to be a little closer to what happens around Under The Rug.",
  "utr.access.p2":
    "Artists, volunteers, collaborators, audience members and other curious people are welcome.",
  "utr.access.tell": "Tell us who you are, and we'll send you access.",

  // ── Portal: footer ────────────────────────────────────────────────────
  "utr.footer.about": "The community around Under The Rug. {location}, since {year}.",
  "utr.footer.community": "The community",
  "utr.footer.request": "Request access",
  "utr.footer.login": "Log in",
  "utr.footer.events": "Open events",
  "utr.footer.line": "Under The Rug · {location} · Norway",
  "utr.footer.poweredBy": "Powered by",

  // ── Request form ──────────────────────────────────────────────────────
  "utr.form.submit": "Request access",
  "utr.form.sending": "Sending…",
  "utr.form.inviteOnly":
    "Right now you get in by invitation from someone who's already inside. If you know someone, ask them.",
  "utr.form.thanks": "Thank you. We've got it.",
  "utr.form.haveRequest": "We have your request.",
  "utr.form.lookAt":
    "Someone from Under The Rug will look at it, and you'll hear from us once you're in.",
  "utr.form.accountNote":
    "If you already have a TING account with this address, your access becomes active the next time you sign in. If you don't, you'll get an email with a link to sign in or create an account. If you don't hear anything, feel free to ask us directly.",
  "utr.form.displayName": "Display name",
  "utr.form.displayNameHint": "This is the name other people see you as inside.",
  "utr.form.email": "Email",
  "utr.form.tagline":
    "No membership fee. No feed to keep up with. Just a place for people, ideas and things happening.",
  "utr.form.haveAccount": "Already have an account?",
  "utr.form.login": "Log in",
  "utr.form.smallPrint":
    "Requesting access doesn't create a membership, and someone from {name} approves every request. The community lives on TING, a separate service that doesn't affect any formal membership of {name}.",
  "utr.form.smallPrintNoAccount":
    " You don't need an account to ask — if you're approved, you'll sign in or create one then.",

  // ── Sign-in page ──────────────────────────────────────────────────────
  "login.metaTitle": "Log in",
  "login.continueAs": "Continue as {name}",
  "login.label": "Log in",
  "login.title": "Welcome back",
  "login.lead":
    "We'll email you a link. No password to remember, and nothing to lose if someone gets hold of your computer.",
  "login.sentTitle": "Check your email",
  "login.sentPre": "If ",
  "login.sentPost":
    " has an account with us, a sign-in link is now waiting there. The link is valid for one hour.",
  "login.emailLabel": "Email address",
  "login.emailPlaceholder": "name@example.com",
  "login.send": "Send link",
  "login.error": "Something went wrong: {error}",
  "login.err.email": "the email address is missing",
  "login.err.link": "the link has been used or has expired",
  "login.err.generic": "unknown error",
  "login.community.title": "Heading into a community?",
  "login.community.body":
    "Sign in with your email address. If you came from a community, we'll send you back there after you sign in.",
  "login.backTo": "Back to {name}",
  "login.backHome": "Back to the front page",

  // ── Invitation page ───────────────────────────────────────────────────
  "inv.metaTitle": "Invitation",
  "inv.invalid.title": "This invitation isn't valid",
  "inv.invalid.body":
    "The link may have been used, withdrawn or expired. Ask whoever invited you to send a new one.",
  "inv.toFront": "Go to the front page",
  "inv.label.approved": "Access approved",
  "inv.label.invitation": "Invitation",
  "inv.lede.approved": "Your access to",
  "inv.lede.invited": "You're invited to",
  "inv.approvedSuffix": " is approved",
  "inv.runsOnTing": "The private community runs on TING — an account there gives you access.",
  "inv.approvedFor": "Approved for ",
  "inv.approvedAfter": ". The link is valid until {date} and can be used once.",
  "inv.sentTo": "The invitation was sent to ",
  "inv.sentAfter": ". It's valid until {date} and can be used once.",
  "inv.signIn.approved":
    "Sign in or create a TING account with that address to get the access that's already been approved.",
  "inv.signIn.invited":
    "Sign in with that address to join. If you don't have a TING account, one is created when you use the sign-in link.",
  "inv.continueWith": "Continue with {email}",
  "inv.mismatch":
    "You're signed in as {signedIn}, but the invitation was sent to {email}. Sign in with that address to join.",
  "inv.switchAccount": "Switch account",
  "inv.footer":
    "TING is a separate digital platform that organizations use to run their communities. TING doesn't manage your formal membership of {name}.",
  "inv.activating": "Activating your access…",
  "inv.continue": "Continue",

  // ── Invitation email ──────────────────────────────────────────────────
  "email.invitation.subject": "Your access to {community} has been approved",
  "email.invitation.badge": "Approved",
  "email.invitation.intro": "Your access to {community} on TING has been approved.",
  "email.invitation.body":
    "An administrator of {community} has approved your request for access. All that's left is to sign in — if you don't have a TING account yet, one is created right away.",
  "email.invitation.loginLabel": "Sign in:",
  "email.invitation.button": "Sign in and get access",
  "email.invitation.expires": "The link works until {date} and can only be used once.",
  "email.invitation.about":
    "TING is a separate digital platform that organizations use to run their communities. TING is not the same as {community}, and doesn't manage your formal membership of the organization.",
  "email.invitation.ignore":
    "If you didn't ask for this, you can ignore this email. Nothing will happen, and no account will be created.",
};
