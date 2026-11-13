(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let motionEnabled = !motionQuery.matches;
  let manuallyDisabled = false;
  const story = document.querySelector('.story');
  const stage = document.querySelector('.story-stage');
  const canvas = document.querySelector('#food-canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const buttons = [...document.querySelectorAll('[data-scene]')];
  const tracks = buttons.map(button => button.querySelector('i'));
  const motionButton = document.querySelector('.motion-toggle');
  const counts = [108, 144, 144];
  const sceneIds = ['fire', 'slice', 'wrap'];
  const cache = new Map();
  const failed = new Set();
  const pending = new Set();
  const posters = new Map();
  let queue = [];
  let working = 0;
  let target = 0;
  let progress = 0;
  let activeScene = -1;
  let activeFrame = 0;
  let raf = 0;
  let width = 0;
  let height = 0;
  let variant = innerWidth < 760 ? 'mobile' : 'desktop';
  let generation = 0;
  let maxCache = variant === 'mobile' ? 28 : 20;
  let storyVisible = true;
  let travel = 1;
  let storyTop = 0;
  let lastWarm = '';
  const filmColor = getComputedStyle(root).getPropertyValue('--color-film').trim();
  const economical = navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '');
  let direction = 1;
  let format = 'avif';
  let lastDrawn = '';
  const clamp = value => Math.min(1, Math.max(0, value));
  const key = (scene, frame) => `${scene}:${frame}`;
  const source = (scene, frame) => `./assets/cinema/${variant}/${sceneIds[scene]}/${String(frame + 1).padStart(3, '0')}.${format}`;

  function requestTick() { if (!raf && motionEnabled && !document.hidden) raf = requestAnimationFrame(tick); }
  function prune() {
    if (cache.size <= maxCache) return;
    const current = key(activeScene, activeFrame);
    for (const k of cache.keys()) {
      if (k === current || pending.has(k)) continue;
      cache.delete(k);
      if (cache.size <= maxCache) break;
    }
  }
  function runQueue() {
    if (!motionEnabled || !storyVisible || document.hidden) { queue = []; return; }
    while (working < 3 && queue.length) {
      const item = queue.shift();
      const k = key(item.scene, item.frame);
      if (cache.has(k) || pending.has(k) || failed.has(k)) continue;
      working++;
      pending.add(k);
      const version = generation;
      const img = new Image();
      img.decoding = 'async';
      img.onload = async () => {
        try { await img.decode(); } catch (_) { /* onload already confirms a usable image */ }
        if (version !== generation) { working--; runQueue(); return; }
        cache.set(k, { img, scene: item.scene, frame: item.frame });
        pending.delete(k); working--; prune(); requestTick(); runQueue();
      };
      img.onerror = () => {
        if (version === generation && img.src.endsWith('.avif')) {
          format = 'webp'; img.src = source(item.scene, item.frame); return;
        }
        if (version === generation) { failed.add(k); pending.delete(k); }
        working--; runQueue();
      };
      img.src = source(item.scene, item.frame);
    }
  }
  function warm(scene, frame) {
    if (!storyVisible) return;
    const signature = `${generation}:${scene}:${frame}:${direction}`;
    if (signature === lastWarm) return;
    lastWarm = signature;
    const desired = [{ scene, frame }];
    for (let distance = 1; distance <= (economical ? 2 : 7); distance++) {
      for (const f of [frame + distance * direction, frame - distance * direction]) if (f >= 0 && f < counts[scene]) desired.push({ scene, frame: f });
    }
    if (!economical && frame > counts[scene] - 12 && scene < 2) for (let f = 0; f < 3; f++) desired.push({ scene: scene + 1, frame: f });
    if (!posters.has(scene)) loadPoster(scene);
    queue = desired;
    runQueue();
  }
  function closest(scene, frame) {
    const exact = cache.get(key(scene, frame));
    if (exact) { cache.delete(key(scene, frame)); cache.set(key(scene, frame), exact); return exact; }
    let nearest = null;
    for (const value of cache.values()) if (value.scene === scene && (!nearest || Math.abs(value.frame - frame) < Math.abs(nearest.frame - frame))) nearest = value;
    return nearest || (posters.has(scene) ? { img: posters.get(scene), scene, frame: -1 } : null);
  }
  function drawImage(img, scene, opacity = 1) {
    context.globalAlpha = opacity;
    const mobile = width < 760;
    const targetY = mobile ? height * .35 : 0;
    const targetHeight = mobile ? height * .65 : height;
    const scale = Math.max(width / img.naturalWidth, targetHeight / img.naturalHeight);
    const drawWidth = img.naturalWidth * scale;
    const drawHeight = img.naturalHeight * scale;
    const focus = mobile ? .5 : scene === 2 ? .75 : .65;
    let x = (width - drawWidth) * focus;
    if (!mobile && scene === 2) x += width * .17;
    const y = targetY + (targetHeight - drawHeight) / 2;
    context.drawImage(img, x, y, drawWidth, drawHeight);
    context.globalAlpha = 1;
  }
  function paint(scene, frame, localProgress) {
    const item = closest(scene, frame);
    if (!item) return;
    const blend = scene > 0 && localProgress < .045 ? clamp(localProgress / .045) : 1;
    const signature = `${generation}:${scene}:${item.frame}:${width}:${height}:${Math.round(blend * 40)}`;
    if (signature === lastDrawn) return;
    context.fillStyle = filmColor;
    context.fillRect(0, 0, width, height);
    if (blend < 1) {
      const prior = closest(scene - 1, counts[scene - 1] - 1);
      if (prior) drawImage(prior.img, scene - 1);
      drawImage(item.img, scene, blend);
    } else drawImage(item.img, scene);
    lastDrawn = signature;
    canvas.dataset.scene = sceneIds[scene];
    canvas.dataset.frame = String(item.frame);
    canvas.classList.add('is-ready');
  }
  function syncChapters(scene, local) {
    if (scene !== activeScene) {
      activeScene = scene;
      chapters.forEach((chapter, index) => {
        const current = index === scene;
        chapter.classList.toggle('is-current', current);
        chapter.inert = !current;
        chapter.setAttribute('aria-hidden', String(!current));
      });
      buttons.forEach((button, index) => {
        button.classList.toggle('is-active', index === scene);
        if (index === scene) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      });
    }
    tracks.forEach((track, index) => track.style.transform = `scaleX(${index < scene ? 1 : index === scene ? local : 0})`);
  }
  function tick() {
    raf = 0;
    if (!motionEnabled || document.hidden || !storyVisible) return;
    const difference = target - progress;
    progress = Math.abs(difference) < .00025 ? target : progress + difference * .22;
    const normalized = Math.min(progress * 3, 2.999999);
    const scene = Math.floor(normalized);
    const local = normalized - scene;
    const frame = Math.min(counts[scene] - 1, Math.round(local * (counts[scene] - 1)));
    const changed = activeScene !== scene || activeFrame !== frame;
    syncChapters(scene, local);
    activeFrame = frame;
    paint(scene, frame, local);
    if (changed || !cache.has(key(scene, frame))) warm(scene, frame);
    if (progress !== target) requestTick();
  }
  function onScroll() {
    if (!motionEnabled) return;
    const next = clamp((scrollY - storyTop) / travel);
    if (next !== target) direction = next > target ? 1 : -1;
    target = next;
    requestTick();
  }
  function resize() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    const nextVariant = width < 760 ? 'mobile' : 'desktop';
    if (nextVariant !== variant) {
      variant = nextVariant; generation++; cache.clear(); posters.clear(); pending.clear(); failed.clear(); queue = []; lastWarm = ''; activeFrame = -1;
      loadPoster(Math.max(0, activeScene));
    }
    maxCache = width < 760 ? 28 : 20;
    const ratio = Math.min(devicePixelRatio || 1, width < 760 ? 1.5 : 1.25);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    lastDrawn = '';
    storyTop = scrollY + story.getBoundingClientRect().top;
    travel = Math.max(1, story.offsetHeight - stage.offsetHeight);
    onScroll();
  }
  function goScene(scene) {
    if (!motionEnabled) { document.querySelector('#story').scrollIntoView({ behavior: 'auto' }); return; }
    const start = scrollY + story.getBoundingClientRect().top;
    const travel = story.offsetHeight - stage.offsetHeight;
    const destination = start + travel * ((scene + .025) / 3);
    scrollTo({ top: destination, behavior: motionQuery.matches ? 'auto' : 'smooth' });
  }
  function setMotion() {
    motionEnabled = !motionQuery.matches && !manuallyDisabled;
    root.classList.toggle('motion-enabled', motionEnabled);
    motionButton.setAttribute('aria-pressed', String(!motionEnabled));
    motionButton.disabled = motionQuery.matches;
    motionButton.setAttribute('aria-label', motionEnabled ? 'Выключить анимацию' : 'Включить анимацию');
    motionButton.querySelector('span').textContent = motionQuery.matches ? 'Движение уменьшено' : motionEnabled ? 'Без анимации' : 'Включить анимацию';
    if (!motionEnabled) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; queue = []; activeScene = -1; syncChapters(0, 0);
    } else { activeScene = -1; lastWarm = ''; warm(0, 0); }
    resize();
  }
  buttons.forEach(button => button.addEventListener('click', () => goScene(Number(button.dataset.scene))));
  document.querySelectorAll('[data-scene-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); goScene(Number(link.dataset.sceneLink)); }));
  document.querySelector('[data-next-scene]').addEventListener('click', () => goScene(Math.min(2, activeScene + 1)));
  motionButton.addEventListener('click', () => {
    if (motionQuery.matches) return;
    const top = scrollY + story.getBoundingClientRect().top;
    const inside = story.getBoundingClientRect().bottom > 0 && story.getBoundingClientRect().top < innerHeight;
    manuallyDisabled = !manuallyDisabled; setMotion();
    if (inside) scrollTo({ top, behavior: 'instant' });
  });
  motionQuery.addEventListener('change', setMotion);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', resize, { passive: true });
  addEventListener('pageshow', onScroll);
  document.addEventListener('visibilitychange', () => { if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; } else onScroll(); });
  function loadPoster(scene) {
    if (posters.has(scene)) return;
    const version = generation;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { if (version !== generation) return; posters.set(scene, image); requestTick(); };
    image.src = `./assets/${sceneIds[scene]}${variant === 'mobile' ? '-mobile' : ''}-poster.webp`;
  }
  loadPoster(0);
  new IntersectionObserver(([entry]) => {
    storyVisible = entry.isIntersecting;
    if (storyVisible) { lastWarm = ''; warm(Math.max(0, activeScene), Math.max(0, activeFrame)); onScroll(); }
    else { queue = []; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }).observe(story);
  setMotion();

  const menuToggle = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('#mobile-menu');
  function closeMenu() { mobileMenu.hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Открыть меню'); }
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open)); menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню'); mobileMenu.hidden = !open;
  });
  mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !mobileMenu.hidden) { closeMenu(); menuToggle.focus(); } });

  const dialog = document.querySelector('#dish-dialog');
  const dishes = {
    classic: { title: 'Та самая классика', description: 'Мясо с вертела, томаты, лук, зелень и чесночный соус в поджаренном лаваше.', spice: 0 },
    hot: { title: 'С огоньком', description: 'Мясо, овощи, зелень и соус с острым акцентом. Выберите комфортную для вас остроту.', spice: 1 },
    fresh: { title: 'Больше свежести', description: 'Мясо с вертела, увеличенная порция овощей и зелени. Соус можно выбрать при заказе.', spice: 0 }
  };
  let selectedDish = dishes.classic;
  function selection() { return `${selectedDish.title}. Острота: ${dialog.querySelector('input[name="spice"]:checked').value}.`; }
  function updateChoice() { dialog.querySelector('.choice-summary').textContent = selection(); dialog.querySelector('.copy-status').textContent = ''; }
  document.querySelectorAll('[data-dish]').forEach(button => button.addEventListener('click', () => {
    selectedDish = dishes[button.dataset.dish];
    document.querySelector('#dish-title').textContent = selectedDish.title;
    document.querySelector('#dish-description').textContent = selectedDish.description;
    dialog.querySelectorAll('input[name="spice"]')[selectedDish.spice].checked = true;
    updateChoice(); dialog.showModal();
  }));
  dialog.querySelectorAll('input[name="spice"]').forEach(input => input.addEventListener('change', updateChoice));
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  document.querySelector('#copy-choice').addEventListener('click', async () => {
    const status = dialog.querySelector('.copy-status');
    try { await navigator.clipboard.writeText(selection()); status.textContent = 'Выбор скопирован. Заказ не отправлялся.'; }
    catch (_) { status.textContent = 'Скопируйте текст вашего выбора выше. Заказ не отправлялся.'; }
  });
})();
