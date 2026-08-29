(function (global) {
  'use strict';

  var activeAnimation = null;
  var animeModulePromise = null;
  var importWarningShown = false;

  function prefersReducedMotion() {
    return Boolean(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function visibleTargets(elements) {
    return Array.prototype.slice.call(elements || []).filter(function (element) {
      return element && !element.hidden && !element.classList.contains('filter-hidden');
    });
  }

  function restoreFinalState(elements) {
    visibleTargets(elements).forEach(function (element) {
      element.style.opacity = '1';
      element.style.transform = '';
    });
  }

  function loadAnime() {
    if (prefersReducedMotion()) return Promise.resolve(null);
    if (!animeModulePromise) {
      animeModulePromise = import('./vendor/anime.esm.min.js').catch(function (error) {
        if (!importWarningShown) {
          importWarningShown = true;
          console.warn('任务卡动效加载失败，已切换为静态显示。', error && error.message ? error.message : error);
        }
        return null;
      });
    }
    return animeModulePromise;
  }

  async function animateTaskCards(elements) {
    var targets = visibleTargets(elements);
    restoreFinalState(targets);
    if (!targets.length || prefersReducedMotion()) return;

    var anime = await loadAnime();
    if (!anime || typeof anime.animate !== 'function') return;
    if (activeAnimation && typeof activeAnimation.cancel === 'function') activeAnimation.cancel();

    activeAnimation = anime.animate(targets, {
      opacity: { from: 0 },
      y: { from: 12 },
      duration: 360,
      delay: typeof anime.stagger === 'function' ? anime.stagger(36) : 0,
      ease: 'outExpo',
      onComplete: function () {
        restoreFinalState(targets);
        activeAnimation = null;
      }
    });
  }

  async function highlightTaskCard(element) {
    if (!element || prefersReducedMotion()) return;
    var anime = await loadAnime();
    if (!anime || typeof anime.animate !== 'function') return;
    if (activeAnimation && typeof activeAnimation.cancel === 'function') activeAnimation.cancel();

    activeAnimation = anime.animate(element, {
      boxShadow: [
        '0 8px 24px rgba(92, 46, 145, 0.12)',
        '0 10px 30px rgba(242, 56, 122, 0.34)',
        '0 8px 24px rgba(92, 46, 145, 0.12)'
      ],
      duration: 420,
      ease: 'outExpo',
      onComplete: function () { activeAnimation = null; }
    });
  }

  global.DandanMotion = {
    animateTaskCards: animateTaskCards,
    highlightTaskCard: highlightTaskCard
  };
})(window);
