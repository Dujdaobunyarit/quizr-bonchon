window.quizAudio = (() => {
  const preferenceKey = 'quizr-audio-v2';
  let enabled = localStorage.getItem(preferenceKey) === 'on';
  let scene = '';
  let context;
  let master;
  let music;
  let scheduler;
  let step = 0;
  let beatAt = 0;
  let currentBar = 0;
  const notes = {
    join: [72, 76, 79],
    start: [67, 72, 76, 79],
    answer: [74, 81],
    reveal: [60, 67, 72],
    tick: [84],
    good: [72, 76, 79, 84],
    bad: [65, 61, 57],
    leaderboard: [65, 69, 72, 77],
    podium: [60, 60, 67, 72, 76, 79, 84]
  };
  const chords = [[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,65]];
  const hz = note => 440 * 2 ** ((note - 69) / 12);

  function tone(output, note, time, length, gain, shape = 'triangle', drop = 0) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(hz(note),time);
    if (drop) oscillator.frequency.exponentialRampToValueAtTime(hz(note-drop),time+length);
    envelope.gain.setValueAtTime(0.001,time);
    envelope.gain.exponentialRampToValueAtTime(gain,time+0.015);
    envelope.gain.exponentialRampToValueAtTime(0.001,time+length);
    oscillator.connect(envelope).connect(output);
    oscillator.start(time);
    oscillator.stop(time+length+0.02);
  }

  function schedule() {
    if (context.state !== 'running') return;
    if (beatAt < context.currentTime - 0.1) beatAt = context.currentTime + 0.05;
    while (beatAt < context.currentTime + 0.14) {
      const quiz = scene === 'question';
      const chord = chords[currentBar % chords.length];
      const speed = quiz ? 0.205 : 0.27;
      if (step % 4 === 0) {
        tone(music,chord[0]-24,beatAt,speed*1.8,0.085,'sine');
        tone(music,43,beatAt,0.11,quiz?0.09:0.055,'sine',17);
      }
      if (step % 2 || !quiz) tone(music,chord[[0,1,2,1,3,2,1,2][step]]+12,beatAt,speed*1.5,quiz?0.03:0.055);
      if (step === 2 || step === 6) tone(music,100,beatAt,0.045,0.02,'triangle',8);
      beatAt += speed;
      step = (step + 1) % 8;
      if (!step) currentBar += 1;
    }
  }

  function restartMusic() {
    clearInterval(scheduler);
    scheduler = null;
    if (!context) return;
    music?.gain.setTargetAtTime(0,context.currentTime,0.06);
    if (!enabled || !scene || context.state !== 'running') return;
    music = context.createGain();
    music.gain.value = 0.55;
    music.connect(master);
    step = 0;
    currentBar = 0;
    beatAt = context.currentTime+0.08;
    schedule();
    scheduler = setInterval(schedule,85);
  }

  async function unlock() {
    if (!enabled) return;
    if (!context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('Sound is unavailable');
      context = new Audio();
      master = context.createGain();
      master.gain.value = 0.65;
      master.connect(context.destination);
    }
    if (context.state !== 'running') await context.resume();
    if (!scheduler) restartMusic();
  }

  document.addEventListener('pointerdown', () => { if (enabled && context?.state !== 'running') unlock().catch(()=>{}); });
  document.addEventListener('keydown', () => { if (enabled && context?.state !== 'running') unlock().catch(()=>{}); });
  return {
    get enabled() { return enabled; },
    async toggle() {
      enabled = !enabled;
      try {
        if (enabled) await unlock();
      } catch (error) {
        enabled = false;
        throw error;
      } finally {
        localStorage.setItem(preferenceKey,enabled?'on':'off');
        if (master) master.gain.setTargetAtTime(enabled?0.65:0,context.currentTime,0.04);
        if (!enabled) restartMusic();
      }
      return enabled;
    },
    scene(next) {
      if (scene === next) return;
      scene = next;
      restartMusic();
    },
    play(effect) {
      if (!enabled || context?.state !== 'running' || !notes[effect]) return;
      const fanfare = effect === 'podium';
      notes[effect].forEach((note,index) => {
        const time=context.currentTime+0.015+index*(fanfare?0.15:0.085);
        tone(master,note,time,fanfare?0.38:0.17,fanfare?0.16:0.13);
        if (fanfare) tone(master,note-12,time,0.4,0.08,'sine');
      });
    }
  };
})();
