import type { account as source } from "../nb/account";

export const account: Record<keyof typeof source, string> = {
  "account.title": "Your account",
  "account.language": "Language",
  "account.language.saving": "Saving language …",
  "account.language.saved": "Your language preference has been saved.",
  "account.language.error": "Your language preference couldn't be saved. Try again.",
  "account.language.signedOut": "Your session has expired. Log in again to save your language preference.",
  "account.profiles": "My profiles",
  "account.profiles.intro": "You can use a different name, photo and bio in each community.",
  "account.profiles.edit": "Edit profile",
  "account.profiles.editIn": "Edit profile in {name}",
  "account.profiles.missing": "Profile not set up",
  "account.profiles.empty.title": "No profiles yet",
  "account.profiles.empty.body": "When you join a community, you get a profile there. Open the community's invitation or request access on their website to get started.",
  "account.privacy": "Privacy",
  "account.privacy.body": "TING neither sells nor shares your personal information with unauthorised parties. We use it only to operate the service and connect you with your communities.",
  "account.privacy.link": "Learn more about how we handle your personal information.",
  "account.logout": "Log out",
  // ── Sign-in page: password ────────────────────────────────────────────
  "login.password.title": "Log in to TING",
  "login.passwordLabel": "Password",
  "login.submit": "Log in",
  "login.working": "Logging in …",
  "login.forgot": "Forgot your password?",
  "login.useLink": "Log in with an email link",
  "login.usePassword": "Log in with a password",
  "login.link.lead": "We'll email you a sign-in link. You don't need your password.",
  "login.err.missing": "Enter your email address and password.",
  "login.err.credentials": "Wrong email address or password.",
  "login.err.rate": "Too many attempts. Wait a moment and try again.",
  "login.err.wait.one": "Too many attempts. Try again in a minute, or log in with an email link.",
  "login.err.wait.other":
    "Too many attempts. Try again in {count} minutes, or log in with an email link.",
  "login.reset.done": "Your password has been changed. Log in with the new one.",

  // ── Password fields, shared by every form that sets one ───────────────
  "password.new": "Password",
  "password.newChange": "New password",
  "password.confirm": "Repeat the password",
  "password.current": "Current password",
  "password.hint": "At least {min} characters. A sentence you remember beats a short, complicated password.",
  "password.working": "Saving …",
  "password.err.tooShort": "The password must be at least {min} characters.",
  "password.err.tooLong": "The password is too long. Use fewer than {max} characters.",
  "password.err.mismatch": "The two passwords don't match.",
  "password.err.pwned": "This password appears in known data breaches. Choose another.",
  "password.err.weak": "The password is too weak. Choose a longer one.",
  "password.err.same": "Choose a password different from your current one.",
  "password.err.current": "The current password isn't right.",
  "password.err.rate": "Too many attempts. Wait a moment and try again.",
  "password.err.wait.one": "Too many attempts. Try again in a minute.",
  "password.err.wait.other": "Too many attempts. Try again in {count} minutes.",
  "password.err.failed": "The password couldn't be saved. Try again.",
  "password.err.unavailable": "We can't reach sign-in right now. Try again in a moment.",
  "password.err.useChange": "The account already has a password. Use “Change password” and enter the current one.",
  "password.reauth.title": "Confirm it's you",
  "password.reauth.body":
    "It's been a while since you logged in. Ask for a sign-in link by email, and you can choose a password as soon as you've used it.",
  "password.reauth.action": "Send me a sign-in link",

  // ── Password setup after an approval ──────────────────────────────────
  "setup.metaTitle": "Create a password",
  "setup.label": "One step left",
  "setup.title": "Create a password",
  "setup.lead":
    "Choose a password you can use to log in to TING, even if you later lose access to your email account.",
  "setup.submit": "Create password and continue",
  "setup.signedInAs": "Logged in as {email}.",
  "setup.resume":
    "Once the password is created, open the link in your approval email once more to enter the community.",
  "setup.signOut": "Log out",

  // ── Forgotten password ────────────────────────────────────────────────
  "forgot.metaTitle": "Forgot password",
  "forgot.label": "Forgot password",
  "forgot.title": "Choose a new password",
  "forgot.lead":
    "Enter the email address you log in with, and we'll send a link you can use to choose a new password.",
  "forgot.submit": "Send link",
  "forgot.working": "Sending …",
  "forgot.sent.title": "Check your email",
  "forgot.sent.pre": "If the address is registered, we've sent a link to ",
  "forgot.sent.post": ". It can be used once.",
  "forgot.noInbox":
    "No longer have access to that email address? Then the link can't reach you. Log in with your password and change the address under Your account → Login & security, or contact an administrator in your community.",
  "forgot.back": "← Back to log in",
  "forgot.err.email": "Enter a valid email address.",

  // ── New password from an emailed link ─────────────────────────────────
  "reset.metaTitle": "New password",
  "reset.label": "New password",
  "reset.title": "Choose a new password",
  "reset.lead": "The password is for your TING account, in every community you're part of.",
  "reset.submit": "Save new password",
  "reset.invalid.title": "The link has been used or has expired",
  "reset.invalid.body":
    "A link for choosing a new password works once, and only for a limited time. Ask for a new one and we'll send it right away.",
  "reset.invalid.action": "Ask for a new link",
  "reset.retry": "The link has been used, but you're logged in. Choose a different password to finish.",

  // ── Account security ("Your account" → "Login & security") ─────────────
  "security.heading": "Login & security",
  "security.email": "Email address",
  "security.change": "Change",
  "security.email.change": "Change email address",
  "security.email.pending": "Waiting for confirmation from {email}.",
  "security.email.cancel": "Cancel the change",
  "security.password": "Password",
  "security.password.configured": "Configured",
  "security.password.notConfigured": "Not configured",
  "security.password.none": "You haven't created a password yet.",
  "security.password.create": "Create password",
  "security.password.change": "Change password",
  "security.password.since": "Last changed {date}.",
  "security.password.saved": "Your password has been saved. You can now log in with your email address and password.",
  "security.back": "← Back to your account",

  "security.createPassword.metaTitle": "Create a password",
  "security.createPassword.title": "Create a password",
  "security.createPassword.lead":
    "Create a password to sign in easily to TING.",
  "security.createPassword.submit": "Create password",
  "security.changePassword.metaTitle": "Change password",
  "security.changePassword.title": "Change password",
  "security.changePassword.lead":
    "Enter the password you have now, and choose a new one. You'll be logged out on other devices.",
  "security.changePassword.submit": "Change password",
  "security.changePassword.forgot": "Can't remember the password? Ask for a link to choose a new one.",

  "security.changeEmail.metaTitle": "Change email address",
  "security.changeEmail.title": "Change email address",
  "security.changeEmail.lead":
    "Your account, memberships and profiles move with you to the new address. You don't need access to the old one.",
  "security.changeEmail.current": "Current address",
  "security.changeEmail.new": "New email address",
  "security.changeEmail.password": "Your password",
  "security.changeEmail.passwordHint": "We ask for the password to be sure it's you.",
  "security.changeEmail.submit": "Send confirmation to the new address",
  "security.changeEmail.working": "Sending …",
  "security.changeEmail.sent.title": "Check the new inbox",
  "security.changeEmail.sent.pre": "If the address can be used, we've sent a confirmation link to ",
  "security.changeEmail.sent.post":
    ". The address only changes once you open the link and confirm while logged in. Until then you log in as before.",
  "security.changeEmail.needsPassword.title": "Create a password first",
  "security.changeEmail.needsPassword.body":
    "To change your email address you confirm who you are with your password. The account doesn't have one yet.",
  "security.changeEmail.cooldown.title": "The password was changed recently",
  "security.changeEmail.cooldown.body":
    "For security, the email address can be changed {hours} hours after the password was last created or changed. You can change it from {date} at {time}.",
  "security.changeEmail.err.email": "Enter a valid email address.",
  "security.changeEmail.err.same": "This is already the account's email address.",
  "security.changeEmail.err.password": "The password isn't right.",
  "security.changeEmail.err.cooldown":
    "The password was created or changed recently. The email address can be changed {hours} hours after that.",
  "security.changeEmail.err.rate": "You've just asked for this. Wait a moment and try again.",
  "security.changeEmail.err.failed": "The confirmation couldn't be sent. Try again.",

  // ── Confirming a new address ──────────────────────────────────────────
  "confirmEmail.metaTitle": "Confirm email address",
  "confirmEmail.label": "New email address",
  "confirmEmail.title": "Confirm the new email address",
  "confirmEmail.lead": "Your account moves to {email}. The old address can no longer be used to log in.",
  "confirmEmail.submit": "Confirm and change address",
  "confirmEmail.working": "Confirming …",
  "confirmEmail.signIn.body":
    "Log in with the address and password you've used until now, and you can confirm the new address. The link alone changes nothing.",
  "confirmEmail.signIn.action": "Log in to confirm",
  "confirmEmail.none.title": "No change is waiting",
  "confirmEmail.none.body":
    "The account you're logged in with ({email}) has no email change waiting. The link may have been used, cancelled, or belong to another account.",
  "confirmEmail.done.title": "Your email address has been changed",
  "confirmEmail.done.body": "You now log in with {email}. Everything else is as before.",
  "confirmEmail.half.title": "One confirmation left",
  "confirmEmail.half.body":
    "This link is confirmed. Also open the link sent to the other address to finish.",
  "confirmEmail.invalid.title": "The link isn't valid",
  "confirmEmail.invalid.body": "The link is missing something or is incomplete.",
  "confirmEmail.err.expired": "The link has been used or has expired. Ask for a new confirmation from Your account → Login & security.",
  "confirmEmail.err.failed": "The address couldn't be confirmed. Does the link belong to another account? Try again in a moment, or ask for a new confirmation.",
  "confirmEmail.toAccount": "To your account",
};
