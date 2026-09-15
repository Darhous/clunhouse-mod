const gsap = window.gsap;
const Flip = window.Flip;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let previousState = null;
const liveRoom = document.getElementById('liveRoomStage');

if (liveRoom && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    liveRoom.classList.toggle('motion-offscreen', !entry.isIntersecting);
  }, { threshold: .05 }).observe(liveRoom);
}

if (gsap && Flip) {
  gsap.registerPlugin(Flip);
  gsap.defaults({ duration: .42, ease: 'power2.out', overwrite: 'auto' });

  const visiblePeople = () => [...document.querySelectorAll('.panel.active .user-row[data-flip-id]')]
    .filter((node) => node.getClientRects().length > 0);

  window.addEventListener('modpanel:people:before', () => {
    if (reduceMotion.matches || document.hidden) { previousState = null; return; }
    const targets = visiblePeople();
    previousState = targets.length ? Flip.getState(targets, { props: 'opacity' }) : null;
  });

  window.addEventListener('modpanel:people:after', () => {
    if (!previousState || reduceMotion.matches || document.hidden) return;
    const state = previousState;
    previousState = null;
    requestAnimationFrame(() => {
      Flip.from(state, {
        targets: visiblePeople(),
        duration: .52,
        ease: 'power3.inOut',
        absolute: true,
        simple: true,
        stagger: .012,
        onEnter: (elements) => gsap.fromTo(elements, { autoAlpha: 0, y: 12, scale: .97 }, { autoAlpha: 1, y: 0, scale: 1, duration: .36, stagger: .025, clearProps: 'transform,opacity,visibility' }),
        onLeave: (elements) => gsap.to(elements, { autoAlpha: 0, x: -18, scale: .96, duration: .28 }),
      });
    });
  });

  const metricObserver = new MutationObserver((records) => {
    if (reduceMotion.matches || document.hidden) return;
    const changed = [...new Set(records.map((record) => record.target).filter((node) => node instanceof HTMLElement))];
    if (!changed.length) return;
    gsap.fromTo(changed, { scale: 1.12, color: '#24d6e6' }, { scale: 1, color: '#eef9fb', duration: .46, ease: 'back.out(1.8)', clearProps: 'transform,color' });
  });
  ['liveAllCount', 'liveSpeakerCount', 'liveQueueCount', 'liveModCount'].forEach((id) => {
    const node = document.getElementById(id);
    if (node) metricObserver.observe(node, { childList: true, characterData: true, subtree: true });
  });

  const room = liveRoom;
  if (room) {
    let priorRoomState = room.dataset.roomState;
    new MutationObserver(() => {
      const next = room.dataset.roomState;
      if (next === priorRoomState || reduceMotion.matches || document.hidden) return;
      priorRoomState = next;
      gsap.fromTo(room.querySelectorAll('.stage-metrics > span, .stage-command:not([hidden])'),
        { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: .42, stagger: .045, clearProps: 'transform,opacity,visibility' });
    }).observe(room, { attributes: true, attributeFilter: ['data-room-state'] });
  }

  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('motion-paused', document.hidden);
    if (document.hidden) gsap.globalTimeline.pause();
    else gsap.globalTimeline.resume();
  });
  document.documentElement.dataset.motionEngine = 'gsap-flip';
} else {
  document.documentElement.dataset.motionEngine = 'css-fallback';
}
