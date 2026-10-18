# Task ID: 23

**Title:** Demo Preparation: Backup Video Recording and Devpost Submission

**Status:** pending

**Dependencies:** 22

**Priority:** high

**Description:** Record a 2-minute backup demo video showing the full flow with narration. Write comprehensive Devpost entry covering all features, prizes, technical approach, and accessibility. Prepare for Expo presentation.

**Details:**

Demo preparation:
1. Record backup video (2 minutes max):
   - Script:
     - [0:00-0:15] Problem: "Investing tools are built around charts. For blind users, a chart becomes a list of numbers that hides the trend."
     - [0:15-0:45] Solution demo: Show voice interaction, lesson playback, chart drawing on palm
     - [0:45-1:15] Practice trade: Show trade confirmation, devnet settlement, Explorer link
     - [1:15-1:45] Tokenization: Explain PVOO, show backing check, compare settlement times
     - [1:45-2:00] Call to action: "Sonar makes investing accessible through voice, touch, and sound."
   - Recording setup:
     - Screen capture of app
     - Split screen or picture-in-picture of physical palm arm
     - Voiceover narration
     - Show keyboard shortcuts on screen
     - Include accessibility features (screen reader demo)
   - Editing:
     - Add captions for accessibility
     - Background music (low volume)
     - Smooth transitions
     - Export at 1080p
2. Write Devpost entry:
   - Inspiration: accessibility gap, personal connection if any
   - What it does: voice tutor, felt charts, practice trades, tokenization
   - How we built it:
     - Tech stack: Next.js, Gemini, ElevenLabs, TimescaleDB, Solana, ESP32
     - Architecture: modular, voice-first, accessible-by-design
     - Key decisions: ElevenLabs voice, Gemini function calling, devnet tokens
   - Challenges:
     - Preventing hallucinated numbers with guardrails
     - Synchronizing on-screen and physical arm
     - Graceful degradation for hardware failures
   - Accomplishments:
     - Full keyboard navigation
     - Real market data with tools
     - <4s latency p90
     - Eyes-closed usable
   - What we learned:
     - Accessibility best practices
     - Voice UX design
     - Blockchain settlement
   - What's next:
     - Real brokerage integration (regulation permitting)
     - Options education module
     - Multi-user accounts and progress tracking
   - Prizes targeting:
     - Technica 2026: Best Accessibility Hack, Best Use of AI, Best Hardware Hack
     - Sponsored: ElevenLabs (voice), Gemini (function calling), Tiger Data (time-series data)
   - Built with:
     - List all major technologies and APIs
   - Links:
     - GitHub repo (public)
     - Demo video (YouTube)
     - Live demo (if deployed)
3. Prepare for Expo (Sunday 1 PM):
   - Test setup:
     - Laptop with app running
     - Palm arm connected and tested
     - Backup video ready to play if hardware fails
     - Phone hotspot as network backup
   - Demo script:
     - 30-second version for quick walk-bys
     - 2-minute version for interested judges
     - 5-minute version for detailed questions
   - Talking points:
     - Accessibility is not an afterthought
     - Real data, not invented
     - Tokenization education without real-money risk
   - Handouts (optional):
     - QR code to Devpost
     - Key features list
4. Team preparation:
   - Assign roles: demo driver, hardware monitor, question answerer
   - Practice demo with timer
   - Prepare answers to likely questions:
     - "How accurate is the voice recognition?"
     - "What if the arm breaks?"
     - "Can blind users really use this alone?"
     - "How does tokenization differ from traditional ETFs?"
5. Code freeze and backup:
   - Final commit at 9 AM Sunday
   - Tag as v1.0-technica
   - Create backup of working build
   - Test on fresh laptop clone

Devpost checklist:
- [ ] Title: Sonar: Voice Investing Tutor for Blind Learners
- [ ] Tagline: Learn investing through voice, touch, and sound
- [ ] 2-minute video uploaded
- [ ] At least 4 screenshots (app states, arm drawing, Explorer link, results panel)
- [ ] All team members added
- [ ] Technologies listed
- [ ] All 6 prize categories selected
- [ ] GitHub repo linked and public
- [ ] Submission complete by 11 AM Sunday

Cross-team dependencies:
- Task 20 in the backend tag: Hardware Bridge: Arm Path Planner and Web Serial Connection
- Task 21 in the frontend tag: Accessibility: Full NVDA and VoiceOver Support with ARIA Live Regions

**Test Strategy:**

Review video with someone unfamiliar with project, verify they understand within 2 minutes. Proofread Devpost entry for typos and clarity. Practice demo presentation with timer, stay under 2 minutes. Test all demo scenarios on backup laptop. Verify video plays on Devpost. Test QR codes work. Run through full checklist twice before submission.
