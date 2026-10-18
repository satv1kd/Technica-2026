# Task ID: 17

**Title:** Chart Output: Sonification with Frequency Mapping and Accessible Sound Toggle

**Status:** pending

**Dependencies:** 14, 16

**Priority:** medium

**Description:** Implement sonification that plays chart data as sound, mapping prices to frequencies from 220Hz (low) to 880Hz (high), with clicks per point and thumps for taps. Always available with S key, automatic when arm disconnected or chart sounds enabled.

**Details:**

Sonification implementation:
1. Create apps/web/lib/palm/sonify.ts module
2. Use Web Audio API for sound generation (no external files)
3. Implement frequency mapping:
   - Normalize chart points to [0, 1] (already done by series pipeline)
   - Map to frequency range: 220 Hz (lowest point) to 880 Hz (highest point)
   - Linear interpolation: freq = 220 + (normalized * 660)
4. Implement playback sequence:
   - For each point in series:
     - Play tone at mapped frequency for 150ms
     - Play click sound (short high-frequency burst) to mark point
     - 100ms gap before next point
   - For each tap marker:
     - Play low thump (80 Hz) for 200ms
5. Implement audio context and oscillator creation:
   - Create AudioContext on first use
   - Use OscillatorNode with sine wave for tones
   - Use filtered noise for clicks
   - Use low-frequency sine for thumps
6. Implement controls:
   - S key triggers sonification for current chart
   - Automatic playback when:
     - Palm arm is disconnected (settings.palmArm === 'disconnected')
     - Chart sounds setting is on (settings.chartSounds === true)
   - Stop current sonification if new chart starts
   - Visual indicator: "Playing chart as sound" status
7. Integrate with answer card: when chart is shown and conditions met, auto-play
8. Respect browser autoplay policies: require user gesture for first playback

Pseudo-code:
function sonify(chartOps: ChartOps) {
  const audioCtx = new AudioContext();
  const { points, markers } = chartOps;
  
  let time = audioCtx.currentTime;
  
  points.forEach((point, i) => {
    // Tone for point value
    const osc = audioCtx.createOscillator();
    osc.frequency.value = 220 + (point * 660);
    osc.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.15);
    
    // Click to mark point
    playClick(audioCtx, time);
    
    // Tap if this is a marker
    if (markers.includes(i)) {
      playThump(audioCtx, time + 0.2);
    }
    
    time += 0.25; // 150ms tone + 100ms gap
  });
  
  announce("Playing chart as sound");
}

**Test Strategy:**

Unit test: Generate chart with 5 points [0, 0.25, 0.5, 0.75, 1.0], verify frequencies [220, 385, 550, 715, 880] Hz. Test tap marker creates thump. Manual test: Press S during chart display, verify sound plays. Test automatic playback when arm disconnected. Test stops when new chart starts. Verify respects autoplay policy (requires user gesture). Test with headphones to verify frequency mapping is perceptually linear.
