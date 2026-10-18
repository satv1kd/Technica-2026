// Two-link inverse kinematics for the palm arm.
//
// Mirrors frontend/web/lib/palm/motion.ts so the physical arm and the
// on-screen arm agree. Units are centimetres in the arm's plane with the
// shoulder at the origin; the 6 x 4 cm drawing box sits up and to the left.
// Plain C++ (no Arduino headers) so it also compiles in the host tests.
#pragma once
#include <math.h>

namespace ik {

const float LINK1_CM = 9.0f;  // shoulder to elbow
const float LINK2_CM = 8.0f;  // elbow to stylus

// Drawing box: lower-left corner and size, in cm.
const float BOX_X = -11.0f, BOX_Y = 6.0f, BOX_W = 6.0f, BOX_H = 4.0f;

const float DEG = 180.0f / (float)M_PI;

// Joint soft limits, in radians. Servos turn 0..180 degrees; the elbow is
// also kept off its singular straight and folded positions (0.15 rad) and
// under 135 degrees.
const float SHOULDER_MIN = 0.0f, SHOULDER_MAX = (float)M_PI;
const float ELBOW_MIN = 0.15f, ELBOW_MAX = 135.0f / DEG;

struct Point {
  float x, y;
};

struct Joints {
  float shoulder;  // radians from +x
  float elbow;     // radians, relative to the upper link
};

// Unit-box chart coordinates (x 0 = past .. 1 = today, y 0 = low .. 1 = high) to cm.
inline Point boxToCm(float u, float v) {
  return {BOX_X + u * BOX_W, BOX_Y + v * BOX_H};
}

// Elbow-up solution. Returns false if the target is out of reach or would
// break a joint limit; `out` is left untouched in that case.
inline bool solve(Point target, Joints& out) {
  const float l1 = LINK1_CM, l2 = LINK2_CM;
  const float d2 = target.x * target.x + target.y * target.y;
  const float cosE = (d2 - l1 * l1 - l2 * l2) / (2.0f * l1 * l2);
  if (cosE < -1.0f || cosE > 1.0f) return false;
  const float elbow = acosf(cosE);
  const float shoulder = atan2f(target.y, target.x) - atan2f(l2 * sinf(elbow), l1 + l2 * cosf(elbow));
  if (elbow < ELBOW_MIN || elbow > ELBOW_MAX) return false;
  if (shoulder < SHOULDER_MIN || shoulder > SHOULDER_MAX) return false;
  out = {shoulder, elbow};
  return true;
}

inline Point forward(Joints j) {
  const float a = j.shoulder + j.elbow;
  return {LINK1_CM * cosf(j.shoulder) + LINK2_CM * cosf(a), LINK1_CM * sinf(j.shoulder) + LINK2_CM * sinf(a)};
}

}  // namespace ik
