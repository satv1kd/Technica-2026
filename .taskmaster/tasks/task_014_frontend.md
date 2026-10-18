# Task ID: 14

**Title:** UI Components: Numbered Options Menu, Settings, and Bottom Dock

**Status:** pending

**Dependencies:** 4 ✓, 9 ⧖

**Priority:** high

**Description:** Implement the numbered options menu system with main menu, lesson submenu, settings submenu, and the bottom dock with M (Menu) and R (Repeat) buttons.

**Details:**

Menu and dock implementation:
1. Create apps/web/components/OptionsMenu.tsx
2. Implement main menu (opens on launch and M key):
   - 1 Lessons
   - 2 Ask a question
   - 3 Practice trading
   - 4 Settings
   - 5 Help
   - Vertical list with glass styling
   - Number keys 1-5 navigate
3. Implement submenus:
   - Lessons: Shows all 6 lessons with Done/Up next tags
   - Settings: Speaking speed, Chart sounds, Text size, Palm arm, Reset progress
   - Each submenu adds "0 Back" option
4. Integrate Gemini context-aware suggestion:
   - Use suggest_options tool to get one suggestion
   - Label as "Options from Gemini"
   - Example: "Continue Stocks vs. ETFs" if in middle of lesson
5. Create apps/web/components/BottomDock.tsx
6. Implement dock with two buttons:
   - M Menu (opens main menu)
   - R Repeat voice (replays last audio and chart)
   - Always visible except when Try Asking tray is open
   - Glass styling, accessible labels
   - M and R keyboard shortcuts already mapped
7. Implement settings persistence:
   - Store in database settings table and localStorage
   - Speaking speed: slow (0.8x), normal (1.0x), fast (1.2x)
   - Chart sounds: on/off (toggle sonification)
   - Text size: standard, large (1.5x), extra large (2x)
   - Palm arm: connect/disconnect
   - Reset lesson progress: confirm dialog
8. Spoken confirmation on settings change:
   - "Speaking speed is now fast"
   - "Chart sounds are now off"

Settings implementation pseudo-code:
async function updateSetting(key: string, value: any) {
  // Save to database
  await db.execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?', [key, JSON.stringify(value), JSON.stringify(value)]);
  
  // Mirror to localStorage
  localStorage.setItem(`sonar-${key}`, JSON.stringify(value));
  
  // Apply immediately
  if (key === 'speakingSpeed') {
    tts.setRate(value);
  }
  
  // Speak confirmation
  speak(getConfirmationMessage(key, value));
}

Cross-team dependencies:
- Task 10 in the backend tag: Tutor Brain: Tool Registry and Gemini Function-Calling Loop
- Task 12 in the backend tag: Lesson Engine: Curriculum Loader, Step Player, Quiz Engine, and Progress

**Test Strategy:**

E2E test: Press M, verify menu opens. Press 1, verify Lessons submenu. Press 0, verify back to main menu. Test settings: Change speaking speed, verify confirmation spoken and next TTS uses new rate. Test R button replays last audio instantly. Verify menu reads options aloud on first open. Test Gemini suggestion appears when available. Verify dock hides during Try Asking tray.
