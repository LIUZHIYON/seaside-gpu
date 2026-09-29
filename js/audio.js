/* ============================================================
 * 程序化音频：海浪环境声 / 五声音阶轻音乐 / 海鸥 / 潜水闷音
 * 全部由 Web Audio API 实时合成，无任何外部音频文件
 * ============================================================ */
(function () {
  const S = window.Seaside;

  const A = (S.audio = {
    ctx: null, started: false,
    musicOn: true, ambOn: true,
    nextPluck: 0, nextPad: 0, nextGull: 0
  });

  const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25]; // C 宫五声
  const CHORDS = [
    [130.81, 196.0, 329.63],   // C  G  E
    [110.0, 164.81, 261.63],   // A  E  C
    [87.31, 130.81, 220.0],    // F  C  A
    [98.0, 146.83, 246.94]     // G  D  B
  ];

  function makeNoiseBuffer(ctx, seconds) {
    const sr = ctx.sampleRate;
    const len = sr * seconds;
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    // Paul Kellet 粉噪滤波器
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  A.init = function () {
    if (A.started) return;
    A.started = true;
    const ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // 主链：各总线 → 潜水低通 → 主增益 → 压缩器 → 输出
    A.lpFilter = ctx.createBiquadFilter();
    A.lpFilter.type = 'lowpass';
    A.lpFilter.frequency.value = 20000;
    A.master = ctx.createGain(); A.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    A.lpFilter.connect(A.master); A.master.connect(comp); comp.connect(ctx.destination);

    A.gMusic = ctx.createGain(); A.gMusic.gain.value = 0.5; A.gMusic.connect(A.lpFilter);
    A.gOcean = ctx.createGain(); A.gOcean.gain.value = 0.7; A.gOcean.connect(A.lpFilter);
    A.gSfx = ctx.createGain(); A.gSfx.gain.value = 0.8; A.gSfx.connect(A.lpFilter);

    /* ----- 海浪：粉噪 + 双 LFO 涌动 ----- */
    const noiseBuf = makeNoiseBuffer(ctx, 8);
    const surf = ctx.createBufferSource();
    surf.buffer = noiseBuf; surf.loop = true;
    const surfLP = ctx.createBiquadFilter();
    surfLP.type = 'lowpass'; surfLP.frequency.value = 380; surfLP.Q.value = 0.7;
    A.gSurf = ctx.createGain(); A.gSurf.gain.value = 0.55;
    surf.connect(surfLP); surfLP.connect(A.gSurf); A.gSurf.connect(A.gOcean);
    surf.start();

    const lfo1 = ctx.createOscillator(); lfo1.frequency.value = 0.055;
    const lfo1g = ctx.createGain(); lfo1g.gain.value = 0.26;
    lfo1.connect(lfo1g); lfo1g.connect(A.gSurf.gain); lfo1.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.087;
    const lfo2g = ctx.createGain(); lfo2g.gain.value = 0.14;
    lfo2.connect(lfo2g); lfo2g.connect(A.gSurf.gain); lfo2.start();

    // 浪花高频嘶声
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuf; hiss.loop = true;
    hiss.playbackRate.value = 1.7;
    const hissBP = ctx.createBiquadFilter();
    hissBP.type = 'bandpass'; hissBP.frequency.value = 1500; hissBP.Q.value = 0.5;
    A.gHiss = ctx.createGain(); A.gHiss.gain.value = 0.05;
    hiss.connect(hissBP); hissBP.connect(A.gHiss); A.gHiss.connect(A.gOcean);
    hiss.start();
    const lfo3 = ctx.createOscillator(); lfo3.frequency.value = 0.13;
    const lfo3g = ctx.createGain(); lfo3g.gain.value = 0.032;
    lfo3.connect(lfo3g); lfo3g.connect(A.gHiss.gain); lfo3.start();

    /* ----- 音乐混响（反馈延迟） ----- */
    A.delay = ctx.createDelay(1.0); A.delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    A.delay.connect(fb); fb.connect(A.delay);
    A.delay.connect(wet); wet.connect(A.gMusic);

    A.nextPluck = ctx.currentTime + 1.2;
    A.nextPad = ctx.currentTime + 0.5;
    A.nextGull = ctx.currentTime + 8 + Math.random() * 10;
  };

  /* ----- 一记柔和拨弦 ----- */
  function pluckAt(t, freq, pan) {
    const ctx = A.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.4);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 1.004;
    const g2 = ctx.createGain(); g2.gain.value = 0.32;
    o1.connect(g); o2.connect(g2); g2.connect(g);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p);
    p.connect(A.gMusic);        // 干声
    p.connect(A.delay);         // 送混响
    o1.start(t); o2.start(t);
    o1.stop(t + 4.6); o2.stop(t + 4.6);
  }

  /* ----- 和弦铺底 ----- */
  function padAt(t, notes) {
    const ctx = A.ctx;
    for (const f of notes) {
      for (const det of [-2.5, 2.5]) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f; o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.022, t + 5.5);
        g.gain.setValueAtTime(0.022, t + 11);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 18);
        o.connect(g); g.connect(A.gMusic);
        o.start(t); o.stop(t + 18.2);
      }
    }
  }

  /* ----- 海鸥鸣叫 ----- */
  function gullAt(t) {
    const ctx = A.ctx;
    const cries = 2 + Math.floor(Math.random() * 3);
    const pan = (Math.random() - 0.5) * 1.6;
    for (let i = 0; i < cries; i++) {
      const st = t + i * 0.34;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const f0 = 1300 + Math.random() * 260;
      o.frequency.setValueAtTime(f0, st);
      o.frequency.exponentialRampToValueAtTime(860 + Math.random() * 130, st + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.045, st + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.26);
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      o.connect(g); g.connect(p); p.connect(A.gSfx);
      o.start(st); o.stop(st + 0.3);
    }
  }

  A.tick = function () {
    if (!A.started || A.ctx.state !== 'running') return;
    const now = A.ctx.currentTime;
    if (A.nextPluck < now + 0.8) {
      pluckAt(A.nextPluck, PENTA[Math.floor(Math.random() * PENTA.length)], (Math.random() - 0.5) * 0.9);
      A.nextPluck += 1.5 + Math.random() * 2.3;
    }
    if (A.nextPad < now + 0.8) {
      padAt(A.nextPad, CHORDS[Math.floor(Math.random() * CHORDS.length)]);
      A.nextPad += 15 + Math.random() * 7;
    }
    if (A.nextGull < now + 0.8) {
      gullAt(A.nextGull);
      A.nextGull += 13 + Math.random() * 22;
    }
  };

  A.toggleMusic = function () {
    if (!A.started) return null;
    A.musicOn = !A.musicOn;
    A.gMusic.gain.setTargetAtTime(A.musicOn ? 0.5 : 0.0, A.ctx.currentTime, 0.3);
    return A.musicOn;
  };

  A.toggleAmbient = function () {
    if (!A.started) return null;
    A.ambOn = !A.ambOn;
    A.gOcean.gain.setTargetAtTime(A.ambOn ? 0.7 : 0.0, A.ctx.currentTime, 0.3);
    A.gSfx.gain.setTargetAtTime(A.ambOn ? 0.8 : 0.0, A.ctx.currentTime, 0.3);
    return A.ambOn;
  };

  A.setUnderwater = function (u) {
    if (!A.started) return;
    A.lpFilter.frequency.setTargetAtTime(u ? 680 : 20000, A.ctx.currentTime, 0.12);
  };

  A.resume = function () {
    if (A.started && A.ctx.state === 'suspended') A.ctx.resume();
  };
  A.suspend = function () {
    if (A.started && A.ctx.state === 'running') A.ctx.suspend();
  };
})();
