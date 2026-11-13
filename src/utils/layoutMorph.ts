const CARD_ATTR = 'data-morph-card';
const MORPH_CLASS = 'card-morphing';
const MORPH_ANIMATION_ID = 'card-morph';
const DURATION = 460;
const MAX_STAGGER = 80;

let capturedRects: Map<string, DOMRect> | null = null;

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function captureCardRects() {
  if (typeof document === 'undefined') return;

  document.querySelectorAll<HTMLElement>(`.${MORPH_CLASS}`).forEach((node) => {
    node.getAnimations()
      .filter((animation) => animation.id === MORPH_ANIMATION_ID)
      .forEach((animation) => animation.cancel());
    node.classList.remove(MORPH_CLASS);
  });

  const rects = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>(`[${CARD_ATTR}]`).forEach((node) => {
    const id = node.getAttribute(CARD_ATTR);
    if (!id) return;
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) rects.set(id, rect);
  });
  capturedRects = rects;
}

export function playCardMorph() {
  const before = capturedRects;
  capturedRects = null;
  if (!before || before.size === 0 || prefersReducedMotion()) return;

  const viewportHeight = window.innerHeight;
  let index = 0;

  document.querySelectorAll<HTMLElement>(`[${CARD_ATTR}]`).forEach((node) => {
    const id = node.getAttribute(CARD_ATTR);
    if (!id) return;
    const from = before.get(id);
    if (!from) return;

    const to = node.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;
    if (to.bottom < -120 || to.top > viewportHeight + 120) return;

    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const unchanged = Math.abs(dx) < 1 && Math.abs(dy) < 1
      && Math.abs(scaleX - 1) < 0.02 && Math.abs(scaleY - 1) < 0.02;
    if (unchanged) return;

    const delay = Math.min(index * 8, MAX_STAGGER);
    index += 1;

    node.classList.add(MORPH_CLASS);
    const animation = node.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
        },
        { transform: 'translate(0px, 0px) scale(1, 1)', transformOrigin: 'top left' },
      ],
      {
        duration: DURATION,
        delay,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards',
      },
    );

    animation.id = MORPH_ANIMATION_ID;
    const cleanup = () => node.classList.remove(MORPH_CLASS);
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
  });
}