class SoundEffects {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // スナップ音（ピシッ）
  playSnap() {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    
    // 三角波で、高周波から減衰する音
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.04);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  // 正解音（ピンポン）
  playCorrect() {
    this.init();
    if (!this.ctx) return;

    const playTone = (freq, startOffset, duration) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      const now = this.ctx.currentTime + startOffset;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.start(now);
      osc.stop(now + duration);
    };

    // ミ・ソ (E5, G5)
    playTone(659.25, 0, 0.15); // E5
    playTone(783.99, 0.12, 0.35); // G5
  }

  // 不正解音（ブブー）
  playIncorrect() {
    this.init();
    if (!this.ctx) return;

    const playTone = (freq, duration) => {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      const now = this.ctx.currentTime;
      
      // 不協和音を作るために少しずらした2つののこぎり波
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, now);
      
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(freq * 1.05, now); // 少しデチューン

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.15, now + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0.001, now + duration);

      osc1.start(now);
      osc2.start(now);
      
      osc1.stop(now + duration);
      osc2.stop(now + duration);
    };

    playTone(130, 0.35); // C3 (130Hz)
  }
}

export const sounds = new SoundEffects();
