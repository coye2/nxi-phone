// Keep browser chrome/keyboard changes within the viewport. Pinch zoom remains
// browser-owned: never resize or reposition the layout while it is magnified.
export function initializeAppViewport(win = window, doc = document) {
  const viewport = win.visualViewport;
  let frame = null;
  function update() {
    frame = null;
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = viewport?.height ?? win.innerHeight;
    if (height > 0) doc.documentElement.style.setProperty('--app-height', `${height}px`);
    doc.documentElement.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`);
  }
  function schedule() { if (frame === null) frame = win.requestAnimationFrame(update); }
  for (const event of ['resize', 'pageshow']) win.addEventListener(event, schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  update();
  return () => {
    for (const event of ['resize', 'pageshow']) win.removeEventListener(event, schedule);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    if (frame !== null) win.cancelAnimationFrame(frame);
  };
}
