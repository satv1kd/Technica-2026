# Task ID: 16

**Title:** Chart Output: Realistic Palm Scene with Hand, Arm IK, and Animated Trace

**Status:** pending

**Dependencies:** 15

**Priority:** high

**Description:** Build the on-screen canvas visualization of a realistic left palm with anatomical details, a two-joint robotic arm with inverse kinematics, animated drawing with soft glowing trace, and idle breathing animation.

**Details:**

Palm scene implementation:
1. Create apps/web/lib/palm/ module with hand.ts (geometry), arm.ts (IK + motion), trace.ts
2. Create apps/web/components/PalmScene.tsx with Canvas 2D rendering
3. Implement hand geometry in hand.ts:
   - Left hand, palm up, using bezier curves
   - Palm outline with 5 fingers (4 fingers + opposed thumb)
   - Each finger: 3 phalanges with proper proportions
   - Thumb: 2 visible segments plus metacarpal
   - Anatomical creases: heart line, head line, life line, finger joint creases
   - Warm skin gradient: radial highlight at palm center, darker toward edges
   - Subsurface-style rim light on edges
   - Soft drop shadow beneath hand
4. Implement drawing box:
   - 6cm x 4cm dashed rectangle on palm center
   - Labels: "PAST" (left) and "TODAY" (right)
   - Map normalized [0,1] chart points to this box
5. Implement robotic arm in arm.ts:
   - Two-joint arm (shoulder + elbow) entering from lower right
   - Brushed aluminum material: gradient, highlights, reflections
   - Servo hubs at joints with screw details
   - Lift servo at wrist (pen-up/pen-down mechanism)
   - Soft white stylus tip (inkless)
   - Inverse kinematics solver: given target (x,y), solve for shoulder and elbow angles
   - Movement constraints: joint angle limits, max velocity 4 cm/s (scaled to screen)
6. Implement motion and animation:
   - Trapezoidal velocity profile: ease in, constant speed, ease out
   - Stylus lifts 6px with growing shadow when pen-up
   - Stylus presses down with 120ms ease when pen-down
   - Acceleration limits for realistic motion
   - Idle breathing: hand rises/falls 1-2px every 4s (subtle sway)
7. Implement trace rendering in trace.ts:
   - Drawn lines appear as soft glowing marks on skin
   - Slight indentation shadow effect
   - Lines fade 30% after 10 seconds
   - Clear trace when new chart starts
8. Implement tap visualization:
   - Stylus lifts, quick press, creates skin dimple ripple
   - Ripple expands and fades over 300ms
   - Visual and satisfying feedback
9. Status indicators:
   - "Drawing on your palm" during animation
   - "Drawing finished" when complete
   - "Sent to your palm arm" when hardware connected
10. 60fps target on laptop hardware
11. Respect prefers-reduced-motion: disable all animation if set

IK pseudo-code:
function solveIK(targetX: number, targetY: number): {shoulder: number, elbow: number} {
  const L1 = 8; // shoulder to elbow length (cm)
  const L2 = 6; // elbow to wrist length (cm)
  const d = Math.sqrt(targetX**2 + targetY**2);
  
  // Law of cosines
  const a2 = Math.acos((L1**2 + L2**2 - d**2) / (2 * L1 * L2));
  const a1 = Math.atan2(targetY, targetX) - Math.acos((L1**2 + d**2 - L2**2) / (2 * L1 * d));
  
  return { shoulder: a1, elbow: a2 };
}

**Test Strategy:**

Visual inspection: Verify hand looks anatomically correct with proper creases and gradient. Verify arm enters from lower right with realistic joints. Unit test IK solver with known targets. Performance test: Verify 60fps during drawing animation on mid-range laptop. Test trace fades after 10s. Test tap creates ripple. Test breathing animation is subtle (1-2px). Verify prefers-reduced-motion disables all animation. E2E test: Play lesson 1 step 1, verify arm draws simple line smoothly.
