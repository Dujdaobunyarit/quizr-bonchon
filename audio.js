window.quizAudio = (() => {
  let context;
  let enabled = false;
  let lobby;
  const tunes = {
    join: [659, 880],
    lobby: [262, 330, 392, 330],
    tick: [660],
    good: [523, 659, 784],
    bad: [330, 220],
    podium: [392, 523, 659, 784, 1047]
  };

  function play(name) {
    if (!enabled || !context || !tunes[name]) return;
    tunes[name].forEach((pitch, index) => {
      const start = context.currentTime + index * (name === 'lobby' ? 0.3 : 0.12);
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.frequency.value = pitch;
      volume.gain.setValueAtTime(0, start);
      volume.gain.linearRampToValueAtTime(name === 'lobby' ? 0.018 : 0.07, start + 0.025);
      volume.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.19);
    });
  }

  return {
    async toggle() {
      context ||= new AudioContext();
      await context.resume();
      enabled = !enabled;
      return enabled;
    },
    play,
    lobby(active) {
      if (active && !lobby) lobby = setInterval(() => play('lobby'), 2400);
      if (!active) {
        clearInterval(lobby);
        lobby = null;
      }
    }
  };
})();
