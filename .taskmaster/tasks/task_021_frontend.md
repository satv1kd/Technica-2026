# Task ID: 21

**Title:** Accessibility: Full NVDA and VoiceOver Support with ARIA Live Regions

**Status:** pending

**Dependencies:** 13, 14, 15, 18

**Priority:** high

**Description:** Complete accessibility pass ensuring full keyboard navigation, ARIA live announcements, labeled controls, proper focus management, and no color-only information. Test with NVDA and VoiceOver.

**Details:**

Accessibility implementation:
1. ARIA live regions (already started in lib/a11y/live.ts):
   - Polite live region for state changes and captions
   - Assertive live region for errors and urgent messages
   - Ensure every caption is announced exactly once
   - Announce state transitions: "Listening", "Thinking", etc.
2. Labeled controls:
   - Every button has aria-label
   - Space bar: "Hold space bar to talk"
   - Menu items: "1 Lessons", "2 Ask a question", etc.
   - Quiz options: "Option 1: One stock", etc.
3. Focus management:
   - Focus stays on space bar as primary control
   - After menu selection, return focus to space bar
   - After quiz answer, move focus to next step button
   - Tab order is logical and matches visual layout
4. Keyboard navigation completeness:
   - Every interactive element reachable via keyboard
   - No keyboard traps
   - Escape always cancels/closes
   - All shortcuts documented in Help menu
5. Canvas accessibility:
   - Chart canvas has alt text from lesson step.alt field
   - Example: "Apple stock trend line with a tap marking the peak"
   - Alt updates when chart changes
6. Color independence:
   - Chart legend uses solid vs dashed lines, not just colors
   - Success/error uses icons + color (✓/✗ plus teal/coral)
   - Progress dashes use position + color (amber for done, white for current)
7. Text alternatives:
   - All icons have text labels or aria-label
   - Chart status text: "Drawing on your palm" is visible
8. Screen reader testing:
   - Test full demo flow with NVDA on Windows
   - Test full demo flow with VoiceOver on macOS
   - Verify every piece of information is accessible non-visually
   - Document any screen reader quirks or workarounds
9. Reduced motion:
   - Verify prefers-reduced-motion disables all animations
   - Test with OS setting enabled
10. High contrast mode:
    - Test in Windows High Contrast mode
    - Verify borders and text remain visible

Testing checklist:
- [ ] Launch app with screen reader, hear welcome message
- [ ] Navigate menu with number keys, hear each option
- [ ] Start lesson 1, hear each step's narration
- [ ] Advance with N key, hear "Press N for the next step"
- [ ] Answer quiz with number key, hear result
- [ ] Ask a question, hear caption announced
- [ ] Open settings, change option, hear confirmation
- [ ] Complete a trade, hear settlement checklist
- [ ] Use only keyboard throughout (no mouse)

**Test Strategy:**

Manual testing with real screen readers: Complete full demo flow with NVDA (Windows) and VoiceOver (macOS) with eyes closed or screen off. Automated testing: Use axe-core or similar tool to scan for ARIA issues. Verify 100% of UI is navigable with keyboard only. Test with prefers-reduced-motion enabled. Recruit blind tester to attempt full demo flow with zero sighted assistance (ultimate test from PRD success metrics).
