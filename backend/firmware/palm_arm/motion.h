// Trapezoidal velocity profile: accelerate, cruise at max speed, decelerate.
// Same numbers as frontend/web/lib/palm/motion.ts (4 cm/s, 16 cm/s^2), so a
// move takes as long on the palm as it does on screen.
#pragma once
#include <math.h>

namespace motion {

const float MAX_SPEED_CM_S = 4.0f;
const float ACCEL_CM_S2 = 16.0f;

struct Trapezoid {
  float dist;      // cm
  float duration;  // s
  float peakV;     // cm/s
  float tAcc;      // s spent accelerating (and decelerating)

  explicit Trapezoid(float d, float vmax = MAX_SPEED_CM_S, float accel = ACCEL_CM_S2) : dist(d) {
    const float tFull = vmax / accel;
    const float dFull = 0.5f * accel * tFull * tFull;
    if (2.0f * dFull >= d) {
      // Too short to reach full speed: a triangle profile.
      tAcc = sqrtf(d / accel);
      duration = 2.0f * tAcc;
      peakV = accel * tAcc;
    } else {
      tAcc = tFull;
      duration = 2.0f * tFull + (d - 2.0f * dFull) / vmax;
      peakV = vmax;
    }
  }

  // Fraction of the distance covered at time t (seconds), 0..1.
  float at(float t, float accel = ACCEL_CM_S2) const {
    if (dist <= 0.0f) return 1.0f;
    const float tt = t < 0.0f ? 0.0f : (t > duration ? duration : t);
    float s;
    if (tt < tAcc) s = 0.5f * accel * tt * tt;
    else if (tt <= duration - tAcc) s = 0.5f * accel * tAcc * tAcc + peakV * (tt - tAcc);
    else s = dist - 0.5f * accel * (duration - tt) * (duration - tt);
    const float f = s / dist;
    return f > 1.0f ? 1.0f : f;
  }
};

}  // namespace motion
