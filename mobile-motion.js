// Mobile scrubbing uses fully buffered, short-GOP H.264 instead of network-bound images.
window.initMobileStory = function () {
  'use strict';
  const root = document.documentElement;
  const story = document.querySelector('.story');
  const stage = document.querySelector('.story-stage');
  const poster = document.createElement('img');
  poster.className = 'motion-poster'; poster.alt = ''; poster.setAttribute('aria-hidden', 'true');
  poster.src = './assets/fire-mobile-poster.webp';
  stage.insertBefore(poster, document.querySelector('.story-shade'));
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const buttons = [...document.querySelectorAll('[data-scene]')];
  const tracks = buttons.map(button => button.querySelector('i'));
  const toggle = document.querySelector('.motion-toggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const ids = ['fire', 'slice', 'wrap'];
  const economical = navigator.connection?.saveData;
  const clips = ids.map((id, index) => {
    const video = document.createElement('video');
    video.className = 'story-video';
    video.muted = true; video.defaultMuted = true;
    video.playsInline = true; video.preload = 'auto';
    video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.disablePictureInPicture = true;
    video.poster = `./assets/${id}-mobile-poster.webp`;
    stage.insertBefore(video, document.querySelector('.story-shade'));
    const clip = {video, index, state:'idle', busy:false, ready:false, wanted:0, lastSeek:0, url:null};
    video.addEventListener('loadeddata', () => { clip.ready = true; wake(); });
    video.addEventListener('seeked', () => {
      clip.busy = false;
      if (active === index) video.classList.add('is-ready');
      wake();
    });
    video.addEventListener('error', () => { clip.busy = false; clip.state = 'failed'; });
    return clip;
  });
  let enabled = false, disabled = false, visible = true;
  let active = -1, target = 0, progress = 0, raf = 0, previousTime = 0;
  let travel = 1, start = 0, loading = 0;
  root.classList.add('video-motion');

  function wake() {
    if (!raf && enabled && visible && !document.hidden) raf = requestAnimationFrame(tick);
  }
  async function load(clip) {
    if (clip.state !== 'idle' || loading >= 2 || !enabled || !visible || document.hidden) return;
    clip.state = 'loading'; loading++;
    try {
      const path = `./assets/motion/${ids[clip.index]}-mobile.mp4`;
      if (location.protocol === 'file:') clip.url = path;
      else {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Video unavailable');
        clip.url = URL.createObjectURL(await response.blob());
      }
      clip.video.src = clip.url;
      clip.video.load();
      clip.state = 'loaded';
    } catch (_) { clip.state = 'failed'; }
    finally { loading--; warm(); wake(); }
  }
  function warm() {
    const index = Math.max(0, active);
    load(clips[index]);
    // First scene has network priority. Later scenes download once it is buffered.
    if (!economical && clips[index].state === 'loaded') {
      for (const candidate of [index + 1, index - 1, 2]) if (clips[candidate]) load(clips[candidate]);
    }
  }
  function chapter(scene, local) {
    if (scene !== active) {
      active = scene;
      poster.src = `./assets/${ids[scene]}-mobile-poster.webp`;
      clips.forEach((clip, index) => clip.video.classList.toggle('is-current', index === scene));
      chapters.forEach((el, index) => {
        el.classList.toggle('is-current', index === scene);
        el.inert = index !== scene; el.setAttribute('aria-hidden', String(index !== scene));
      });
      buttons.forEach((button, index) => {
        button.classList.toggle('is-active', index === scene);
        if (index === scene) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      });
      stage.dataset.scene = ids[scene];
      warm();
    }
    tracks.forEach((track, index) => track.style.transform = `scaleX(${index < scene ? 1 : index === scene ? local : 0})`);
  }
  function tick(now) {
    raf = 0;
    if (!enabled || !visible || document.hidden) { previousTime = 0; return; }
    const dt = previousTime ? Math.min(50, now - previousTime) : 16.7;
    previousTime = now;
    const difference = target - progress;
    progress = Math.abs(difference) < .0002 ? target : progress + difference * (1 - Math.exp(-dt / 105));
    const p = Math.min(2.999999, progress * 3), scene = Math.floor(p), local = p - scene;
    chapter(scene, local);
    const clip = clips[scene], video = clip.video;
    if (clip.ready && Number.isFinite(video.duration)) {
      clip.wanted = Math.round(local * Math.max(0, video.duration - 1 / 24) * 24) / 24;
      // Never queue currentTime writes while the decoder is seeking. Keep only the latest target.
      if (!clip.busy && !video.seeking && Math.abs(video.currentTime - clip.wanted) > 1 / 48 && now - clip.lastSeek >= 32) {
        clip.busy = true; clip.lastSeek = now;
        video.currentTime = clip.wanted;
      } else if (!clip.busy && !video.seeking) video.classList.add('is-ready');
    }
    if (progress !== target || (clip.ready && Math.abs(video.currentTime - clip.wanted) > 1 / 48 && !clip.busy)) wake();
    else previousTime = 0;
  }
  function scroll() {
    target = Math.max(0, Math.min(1, (scrollY - start) / travel));
    wake();
  }
  function measure() {
    start = scrollY + story.getBoundingClientRect().top;
    travel = Math.max(1, story.offsetHeight - stage.offsetHeight);
    scroll();
  }
  function setMotion() {
    enabled = !disabled && !reduced.matches;
    root.classList.toggle('motion-enabled', enabled);
    toggle.disabled = reduced.matches;
    toggle.setAttribute('aria-pressed', String(!enabled));
    toggle.setAttribute('aria-label', enabled ? 'Выключить анимацию' : 'Включить анимацию');
    toggle.querySelector('span').textContent = enabled ? 'Без анимации' : 'Включить анимацию';
    if (!enabled) {
      cancelAnimationFrame(raf); raf = 0; previousTime = 0;
      chapter(0, 0);
    } else { active = -1; warm(); }
    measure();
  }
  function goScene(scene) {
    if (!enabled) { story.scrollIntoView(); return; }
    load(clips[scene]);
    scrollTo({top:start + travel * ((scene + .025) / 3), behavior:'smooth'});
  }
  buttons.forEach(button => button.addEventListener('click', () => goScene(Number(button.dataset.scene))));
  document.querySelectorAll('[data-scene-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); goScene(Number(link.dataset.sceneLink)); }));
  document.querySelector('[data-next-scene]').addEventListener('click', () => goScene(Math.min(2, active + 1)));
  toggle.addEventListener('click', () => {
    const inside = story.getBoundingClientRect().bottom > 0 && story.getBoundingClientRect().top < innerHeight;
    disabled = !disabled; setMotion(); if (inside) scrollTo({top:start, behavior:'instant'});
  });
  reduced.addEventListener('change', setMotion);
  addEventListener('scroll', scroll, {passive:true});
  // Mobile browser chrome changes the window height on every swipe. Observe actual layout instead.
  new ResizeObserver(measure).observe(stage);
  new ResizeObserver(measure).observe(story);
  addEventListener('pageshow', measure);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; previousTime = 0; }
    else { warm(); scroll(); }
  });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) { warm(); scroll(); }
    else { cancelAnimationFrame(raf); raf = 0; previousTime = 0; }
  }).observe(story);
  setMotion();
};
