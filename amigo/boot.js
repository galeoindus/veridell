/* Theme ownership belongs to the shared controller in assets/js/global-theme.js.
 * This file used to keep a second settings store and a second click handler for
 * the theme button, so one tap ran two owners in sequence and they could
 * disagree. Appearance has one owner now; the button carries the shared
 * data-theme-toggle contract and nothing here writes theme state. */


/* The "Open settings" button used an inline onclick, which the site's
 * Content-Security-Policy blocks (script-src 'self'). One delegated listener
 * does the same job without weakening the policy. */
document.addEventListener('click', (event) => {
  const trigger = event.target && event.target.closest && event.target.closest('[data-open-settings]');
  if (!trigger) return;
  event.preventDefault();
  const btn = document.getElementById('btnSet');
  if (btn) btn.click();
});
