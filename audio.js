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
  let percussionNoise;
  const notes = {
    join: [76, 81, 86],
    start: [65, 69, 72, 77],
    answer: [76, 84],
    reveal: [67, 72, 76, 79],
    tick: [88],
    count: [76],
    go: [81, 89],
    good: [72, 77, 81, 84, 89],
    bad: [64, 61, 57],
    leaderboard: [62, 69, 74, 77, 81],
    podium: [65, 72, 77, 81, 84, 89]
  };
  const chords = [[53,57,60,65],[50,53,57,62],[46,50,53,57],[48,52,55,60]];
  const riff = [
    [77,null,81,84,null,81,null,79,77,null,72,74,null,76,77,null],
    [74,null,77,81,null,84,null,81,77,null,74,null,72,74,77,null],
    [70,null,74,77,null,81,null,77,74,null,72,70,null,69,70,null],
    [72,null,76,79,null,84,null,79,76,null,79,null,81,79,76,null]
  ];
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

  function percussion(output, time, length, gain, frequency) {
    if (!percussionNoise) {
      const frames = Math.ceil(context.sampleRate * 0.14);
      percussionNoise = context.createBuffer(1,frames,context.sampleRate);
      const data = percussionNoise.getChannelData(0);
      for (let i=0;i<frames;i++) data[i]=Math.random()*2-1;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = percussionNoise;
    filter.type = 'highpass';
    filter.frequency.value = frequency;
    envelope.gain.setValueAtTime(gain,time);
    envelope.gain.exponentialRampToValueAtTime(.001,time+length);
    source.connect(filter).connect(envelope).connect(output);
    source.start(time);
    source.stop(time+length);
  }

  function schedule() {
    if (context.state !== 'running') return;
    if (beatAt < context.currentTime - 0.09) beatAt = context.currentTime + 0.045;
    while (beatAt < context.currentTime + 0.16) {
      const quiz = scene === 'question';
      const bar = currentBar % chords.length;
      const chord = chords[bar];
      const beat = 60/(quiz?148:130)/4;
      if ([0,6,8,10].includes(step)) tone(music,42,beatAt,.13,.25,'sine',16);
      if (step===4 || step===12) {
        percussion(music,beatAt,.105,.19,1100);
        tone(music,51,beatAt,.075,.065,'triangle',5);
      }
      if (step%2===0) percussion(music,beatAt,step%4?.045:.028,step%4?.064:.033,6500);
      if ([0,3,6,8,11,14].includes(step)) {
        const bass = chord[step===6 || step===14 ? 2 : 0]-12;
        tone(music,bass,beatAt,beat*1.7,.175,'triangle');
        tone(music,bass-12,beatAt,beat*1.45,.065,'sine');
      }
      if (step===3 || step===7 || step===11 || step===15) {
        for (const note of chord.slice(1)) tone(music,note+12,beatAt,beat*1.2,.031,'triangle');
      }
      const lead = riff[bar][step];
      if (lead && (!quiz || step%4!==3)) {
        tone(music,lead,beatAt,beat*1.5,quiz?.057:.075,'triangle');
        tone(music,lead+12,beatAt,beat*.73,.014,'square');
      }
      beatAt += beat;
      step = (step + 1) % 16;
      if (!step) currentBar += 1;
    }
  }

  function restartMusic() {
    clearInterval(scheduler);
    scheduler = null;
    if (!context) return;
    if (music) {
      const fading = music;
      fading.gain.setTargetAtTime(.001,context.currentTime,.05);
      setTimeout(()=>fading.disconnect(),420);
      music = null;
    }
    if (!enabled || !scene || context.state !== 'running') return;
    music = context.createGain();
    music.gain.value = 0.56;
    music.connect(master);
    step = 0;
    currentBar = 0;
    beatAt = context.currentTime+0.055;
    schedule();
    scheduler = setInterval(schedule,67);
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
      if (fanfare || effect==='leaderboard') percussion(master,context.currentTime+.02,.11,.17,900);
      notes[effect].forEach((note,index) => {
        const time=context.currentTime+0.015+index*(fanfare?0.15:0.085);
        tone(master,note,time,fanfare?0.38:0.17,fanfare?0.16:0.13);
        if (fanfare) {
          tone(master,note-12,time,.4,.10,'sine');
          tone(master,note+7,time,.25,.034,'triangle');
        }
      });
    }
  };
})();
