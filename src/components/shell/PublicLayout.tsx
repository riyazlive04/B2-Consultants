import { AppFooter } from "./AppFooter";

/**
 * The credit line on the screens OUTSIDE the dashboard shell.
 *
 * `AppShell` already carries `AppFooter`, but it only wraps the `(app)` route group - so the
 * footer stopped at the sign-in page. Everything a prospect or a student actually sees first -
 * the booking form, a funnel page, an agreement, the portals, the password screens - had none,
 * which is the opposite of where a "developed by" line is worth having.
 *
 * ── Why the first child is flattened ─────────────────────────────────────────────
 * Every one of these pages opens with its own `min-h-screen` element, written when nothing sat
 * below it. Left alone that is a full viewport PLUS a footer, so every screen would gain a
 * scrollbar with nothing but the credit line beyond the fold. The child selector overrides that
 * one declaration (a higher-specificity rule, so no `!important` and no page edits) and lets the
 * page grow to fill whatever is left instead. The page still fills the screen; the footer sits
 * under it rather than past it.
 */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col [&>*:first-child]:min-h-0 [&>*:first-child]:flex-1">
      {children}
      <AppFooter />
    </div>
  );
}

export default PublicLayout;
