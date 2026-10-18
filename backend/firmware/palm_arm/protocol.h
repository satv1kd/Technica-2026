// Serial protocol between the bridge (backend/bridge/serial) and the arm.
//
//   H        home and lift          P0 / P1   stylus up / down
//   M x y    move, x and y in [0,1] T ms      tap for ms
//   W ms     wait                   F n       pressure 1..5
//
// One command per line at 115200 baud. The arm answers each with "OK" when
// it has finished, or "ERR_<CODE>". Plain C++ so the host tests can parse
// the same way the ESP32 does.
#pragma once
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

namespace protocol {

enum Kind { HOME, PEN, MOVE, TAP, WAIT, FORCE, INVALID };

// Hard caps. Every reply must arrive before the bridge's 8 s timeout.
const int MAX_TAP_MS = 1000;
const int MAX_WAIT_MS = 5000;
const int MAX_FORCE = 5;  // the firmware never presses harder than this

struct Command {
  Kind kind;
  float x, y;     // MOVE
  int value;      // PEN 0/1, TAP ms, WAIT ms, FORCE level
  const char* error;  // set when kind == INVALID
};

namespace detail {

inline const char* skipSpace(const char* s) {
  while (*s == ' ' || *s == '\t') s++;
  return s;
}

// Parse one number and require a separator or the end after it.
inline bool number(const char*& s, float& out) {
  s = skipSpace(s);
  char* end = nullptr;
  out = strtof(s, &end);
  if (end == s) return false;
  s = end;
  return *s == '\0' || *s == ' ' || *s == '\t' || *s == '\r' || *s == '\n';
}

inline bool done(const char* s) {
  s = skipSpace(s);
  return *s == '\0' || *s == '\r' || *s == '\n';
}

inline Command invalid(const char* code) { return {INVALID, 0, 0, 0, code}; }

inline Command intArg(Kind kind, const char* s, int lo, int hi) {
  float v;
  if (!number(s, v) || !done(s) || v != (float)(int)v) return invalid("ERR_PARSE");
  if (v < lo || v > hi) return invalid("ERR_RANGE");
  return {kind, 0, 0, (int)v, nullptr};
}

}  // namespace detail

inline Command parse(const char* line) {
  using namespace detail;
  const char* s = skipSpace(line);
  const char op = (char)toupper((unsigned char)*s);
  if (op == '\0') return invalid("ERR_PARSE");
  s++;
  switch (op) {
    case 'H':
      return done(s) ? Command{HOME, 0, 0, 0, nullptr} : invalid("ERR_PARSE");
    case 'P':
      // "P0" / "P1" (no space), as the planner sends them.
      if ((*s == '0' || *s == '1') && done(s + 1)) return {PEN, 0, 0, *s - '0', nullptr};
      return invalid("ERR_PARSE");
    case 'M': {
      float x, y;
      if (!number(s, x) || !number(s, y) || !done(s)) return invalid("ERR_PARSE");
      if (x < 0 || x > 1 || y < 0 || y > 1) return invalid("ERR_RANGE");
      return {MOVE, x, y, 0, nullptr};
    }
    case 'T':
      return intArg(TAP, s, 1, MAX_TAP_MS);
    case 'W':
      return intArg(WAIT, s, 0, MAX_WAIT_MS);
    case 'F':
      return intArg(FORCE, s, 1, MAX_FORCE);
    default:
      return invalid("ERR_UNKNOWN");
  }
}

}  // namespace protocol
