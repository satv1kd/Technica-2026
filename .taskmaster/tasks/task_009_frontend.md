# Task ID: 9

**Title:** Voice I/O: Push-to-Talk, ElevenLabs STT/TTS, and Gemini TTS Fallback

**Status:** in-progress

**Dependencies:** 4 ✓

**Priority:** high

**Description:** Implement push-to-talk audio capture, ElevenLabs Speech-to-Text transcription, and streaming Text-to-Speech with ElevenLabs primary and Gemini TTS fallback. Include earcons for state changes.

**Details:**

Voice interface implementation:
1. Create apps/web/lib/voice/ module with pushToTalk.ts, stt.ts, tts.ts, earcons.ts, repeat.ts
2. Implement push-to-talk capture:
   - Record from microphone while Space is held using MediaRecorder API
   - Ignore key repeat events
   - Minimum hold duration: 250ms
   - Output webm/opus blob
   - Play rising earcon on press, falling on release
   - Cancel on Escape
3. Implement STT via apps/web/app/api/stt/route.ts:
   - Send audio blob to ElevenLabs Speech-to-Text API
   - Return transcript and confidence score
   - If confidence < 0.6 or API fails, return error and show typing fallback
4. Implement streaming TTS:
   - Primary: ElevenLabs streaming TTS with configured voice ID
   - Fallback: Gemini TTS (gemini-3.8-flash-tts) with style prompt "warm, patient teacher, slightly slow"
   - Last resort: browser speechSynthesis API
   - Stream audio directly to browser, start playback immediately
   - Cancel previous utterance when starting new one
5. Implement repeat functionality:
   - Cache last audio buffer in memory
   - R key or Repeat button replays instantly without API call
   - If answer has chart, redraw chart too
6. Create earcons using Web Audio API:
   - listening-start: rising tone
   - listening-end: falling tone
   - success: pleasant chime
   - wrong-answer: low tone
   - trade-confirmed: thump
   - no external sound files
7. Implement typing fallback:
   - T key opens labeled text input
   - Enter sends text as transcript
   - Accessible to screen readers

API route pseudo-code:
// apps/web/app/api/tts/route.ts
export async function POST(req: Request) {
  const { text, voiceId } = await req.json();
  try {
    // Try ElevenLabs streaming
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2' })
    });
    return new Response(response.body, { headers: { 'Content-Type': 'audio/mpeg' } });
  } catch (e) {
    // Fallback to Gemini TTS
    // ... implement Gemini Audio API call
  }
}

**Test Strategy:**

E2E test: Hold Space, speak "What is an ETF?", release, verify transcript appears within 3s. Verify audio plays back. Manual test: Press R and verify audio replays instantly. Test with network offline to verify Gemini fallback. Unit test earcon generation produces correct frequencies. Verify minimum 250ms hold prevents accidental captures.
