const toggle = document.querySelector('.theme-toggle');
const label = toggle.querySelector('.theme-toggle__label');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const scene = document.querySelector('.scene');
let transitionTimer;

toggle.addEventListener('click', () => {
  const isNight = document.documentElement.dataset.theme !== 'night';
  document.documentElement.dataset.theme = isNight ? 'night' : 'day';
  toggle.setAttribute('aria-pressed', String(isNight));
  toggle.setAttribute('aria-label', isNight ? '切换到白天' : '切换到夜晚');
  label.textContent = isNight ? '夜晚' : '白天';
  themeMeta.content = isNight ? '#17243d' : '#f9f3f4';
  scene.classList.add('is-transitioning');
  clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => scene.classList.remove('is-transitioning'), 1500);
});
