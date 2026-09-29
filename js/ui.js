/* ============================================================
 * UI：开始界面 / 状态栏 / 提示 / 帮助 / 工具栏
 * ============================================================ */
(function () {
  const S = window.Seaside;
  const $ = (id) => document.getElementById(id);

  S.ui = {
    setMode(txt) { const el = $('chipMode'); if (el) el.textContent = txt; },
    setFps(v) { const el = $('chipFps'); if (el) el.textContent = v + ' FPS'; },
    setPrompt(txt) {
      const el = $('prompt');
      if (!el) return;
      if (txt) { el.textContent = txt; el.classList.add('show'); }
      else el.classList.remove('show');
    },
    setContinueHint(v) { const el = $('continueHint'); if (el) el.classList.toggle('show', v); },
    setUnderwater(v) { const el = $('underwaterTint'); if (el) el.classList.toggle('show', v); },
    toggleHelp() { $('helpPanel').classList.toggle('show'); },
    hideBootTip() { const el = $('bootTip'); if (el) el.classList.add('gone'); }
  };

  S.bindUI = function () {
    $('btnStart').addEventListener('click', () => S.start());

    $('btnMusic').addEventListener('click', function () {
      const on = S.audio.toggleMusic();
      if (on !== null) this.classList.toggle('off', !on);
    });
    $('btnAmbient').addEventListener('click', function () {
      const on = S.audio.toggleAmbient();
      if (on !== null) this.classList.toggle('off', !on);
    });
    $('btnFull').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    });
    $('btnGlow').addEventListener('click', function () {
      const on = !S.postFXOn();
      S.setPostFX(on);
      this.classList.toggle('off', !on);
    });
    $('btnShadow').addEventListener('click', function () {
      const on = !S.R.shadowOn;
      S.setShadow(on);
      this.classList.toggle('off', !on);
    });
    $('btnHelp').addEventListener('click', () => S.ui.toggleHelp());

    document.addEventListener('pointerlockchange', () => {
      if (S.started) S.ui.setContinueHint(!document.pointerLockElement);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) S.audio.suspend();
      else S.audio.resume();
    });

    window.addEventListener('keydown', (e) => {
      if (!S.started) return;
      if (e.code === 'KeyM') {
        const on = S.audio.toggleMusic();
        $('btnMusic').classList.toggle('off', on === false);
      }
      if (e.code === 'KeyH') S.ui.toggleHelp();
      if (e.code === 'KeyB') {
        const on = !S.postFXOn();
        S.setPostFX(on);
        $('btnGlow').classList.toggle('off', !on);
      }
      if (e.code === 'KeyP') {
        const on = !S.R.shadowOn;
        S.setShadow(on);
        $('btnShadow').classList.toggle('off', !on);
      }
      if (e.code === 'Space') e.preventDefault();
    });

    window.addEventListener('resize', () => { /* 主循环每帧检测尺寸变化 */ });
  };

  window.addEventListener('DOMContentLoaded', () => S.bindUI());
})();
