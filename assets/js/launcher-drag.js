/* Veridellindo — the floating Amigo button can be moved out of the way.
 *
 * The launcher is fixed to the bottom-right corner, which is exactly where a
 * reader's thumb, a cookie strip, a chat bubble or the last line of an article
 * tends to be. On a phone it was hidden outright to avoid covering the bottom
 * bar, so the doorway into the assistant disappeared on the device most people
 * use. It is now shown everywhere and can be dragged up or down; the position
 * is remembered, and it is clamped back into the viewport on a resize or a
 * rotation so it can never be dragged off-screen or under the system bars.
 *
 * A drag never navigates: the link only follows a press that moved less than
 * DRAG_THRESHOLD pixels, which is also how a tap on a touch screen is told
 * apart from a swipe.
 */

const KEY = 'veridell.launcher.offsetY';
const DRAG_THRESHOLD = 6;   // px of movement that still counts as a tap
const EDGE = 8;             // px kept clear of the viewport edge

function wireLauncherDrag(doc = document, win = window) {
  const launcher = doc.querySelector('.amigo-launcher');
  if (!launcher || launcher.dataset.dragReady === 'true') return null;
  launcher.dataset.dragReady = 'true';

  let offset = 0;
  try {
    const saved = Number(win.localStorage.getItem(KEY));
    if (Number.isFinite(saved)) offset = saved;
  } catch { /* storage can be blocked; the drag still works for this visit */ }

  let dragging = false;
  let moved = 0;
  let startY = 0;
  let startOffset = 0;
  let pointerId = null;

  const apply = (value) => {
    const rect = launcher.getBoundingClientRect();
    const base = rect.top - offset;                 // where it sits with no offset
    const height = rect.height;
    const min = EDGE - base;                        // keep the top edge on screen
    const max = win.innerHeight - EDGE - height - base;  // keep the bottom edge on screen
    offset = Math.min(Math.max(value, min), Math.max(min, max));
    launcher.style.setProperty('--launcher-y', `${offset}px`);
    launcher.classList.toggle('is-moved', Math.abs(offset) > 1);
    return offset;
  };

  const save = () => {
    try { win.localStorage.setItem(KEY, String(Math.round(offset))); } catch { /* ignore */ }
  };

  apply(offset);

  /* A link is natively draggable, and that native drag starts a drag-and-drop
     sequence which cancels the pointer stream after the first move — the button
     then jumped a few pixels and stopped. The attribute is turned off here as
     well as in CSS. */
  launcher.setAttribute('draggable', 'false');

  launcher.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    moved = 0;
    startY = event.clientY;
    startOffset = offset;
    pointerId = event.pointerId;
    launcher.classList.add('is-dragging');
    // Listen on the window for the rest of the gesture: the launcher moves out
    // from under the pointer as soon as it is dragged, so the element itself
    // stops receiving the moves.
    win.addEventListener('pointermove', onMove, { passive: false });
    win.addEventListener('pointerup', onUp);
    win.addEventListener('pointercancel', onUp);
    event.preventDefault();
  });

  const onMove = (event) => {
    if (!dragging) return;
    if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
    const delta = event.clientY - startY;
    moved = Math.max(moved, Math.abs(delta));
    if (moved > DRAG_THRESHOLD) {
      event.preventDefault();
      apply(startOffset + delta);
    }
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    launcher.classList.remove('is-dragging');
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onUp);
    if (moved > DRAG_THRESHOLD) save();
  };

  // A press that turned into a drag must not open the assistant.
  launcher.addEventListener('click', (event) => {
    if (moved > DRAG_THRESHOLD) {
      event.preventDefault();
      event.stopPropagation();
      moved = 0;
    }
  }, true);

  // Rotation, a resize or the phone's keyboard changing the viewport height can
  // leave a saved offset pointing outside the screen.
  const reclamp = () => apply(offset);
  win.addEventListener('resize', reclamp);
  win.addEventListener('orientationchange', reclamp);

  // Double-tap resets to the corner, so a reader who has dragged it somewhere
  // unhelpful is never stuck without a way back.
  launcher.addEventListener('dblclick', () => {
    offset = 0;
    apply(0);
    save();
  });

  return { apply, get offset() { return offset; } };
}

/* Loaded as a classic script on every page, so it starts itself rather than
   exporting a function nothing would call. */
(function boot() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const start = () => wireLauncherDrag();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
