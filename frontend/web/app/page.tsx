"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { TurnResult } from "../../../backend/services/tutor/loop";
import type { TurnState } from "../../../backend/services/tutor/tools/types";
import { AuroraBackground } from "../components/AuroraBackground";
import { type PalmStatus } from "../components/PalmScene";
import { AnswerCard } from "../components/AnswerCard";
import { ConfirmPanel } from "../components/ConfirmPanel";
import { SettlingChecklist } from "../components/SettlingChecklist";
import { TradeResults, type HistoryPoint } from "../components/TradeResults";
import { SINGLE_TAP, hasDetails, offerDeadline, secondsLeft, type Portfolio, type TradeProposal, type TradeResult } from "../lib/trade";
import { answerView, type QuizView } from "../lib/answer";
import { clearDone, loadDone, markDone, mergeDone } from "../lib/progressCache";
import {
  MockTransport, PalmArm, WebSerialTransport, chooseSerialPort, webSerialSupported, type ArmState,
} from "../../../backend/bridge/serial/palmArm";
import { chartSegments, drawSegments, type DrawJob } from "../../../backend/bridge/serial/palmChart";
import { ArmControls, armStatusText } from "../components/ArmControls";
import { shouldAutoSonify, sonify, stopSonify } from "../lib/palm/sonify";
import type { StepView } from "../../../backend/services/lessons/player";
import type { ChartOps } from "../../../backend/services/chart/ops";
import { announce } from "../lib/a11y/live";
import { keyDownAction, keyUpAction, type KeyAction } from "../lib/a11y/keymap";
import { MIN_HOLD_MS, transition, type AppEvent, type AppState } from "../lib/state/appMachine";
import { PushToTalk } from "../lib/voice/pushToTalk";
import { transcribe } from "../lib/voice/stt";
import { Speaker } from "../lib/voice/tts";
import { repeat } from "../lib/voice/repeat";
import { earcon } from "../lib/voice/earcons";
import {
  DEFAULT_SETTINGS, applyTextSize, flag, loadSettings, saveSettings, setFlag, toggleSetting, type Settings,
} from "../lib/settings";
import {
  HELP, WELCOME, buildMenu, menuChoice, speakMenu,
  type Command, type GeminiOption, type LessonInfo, type MenuId,
} from "../lib/menus";
import { OptionsMenu } from "../components/OptionsMenu";
import { BottomDock } from "../components/BottomDock";
import { DEFAULT_LESSONS, TRAY_TIP_FLAG, trayItems, trayPick, trayTip, type TrayItem } from "../lib/tray";
import { SpaceBar } from "../components/SpaceBar";
import { TryAskingTray } from "../components/TryAskingTray";
import type { UiAction } from "../../../backend/services/tutor/loop";

const HEADINGS: Record<AppState, string> = {
  menu: "Press a number, or space to talk",
  listening: "Listening",
  thinking: "Thinking",
  answer: "Press space to talk",
  lesson: "Press N for the next step",
  quiz: "Press 1, 2, or 3 to answer",
  confirm: "Press Enter to confirm, or Escape to cancel",
  settling: "Settling your trade",
};

/** Settings, option 5 must be pressed twice within this window to reset progress. */
const RESET_CONFIRM_MS = 6000;

/** Keep keyboard focus on the space bar after clicking card buttons. */
function focusSpaceBar() {
  document.querySelector<HTMLButtonElement>(".spacebar")?.focus();
}

export default function Home() {
  const [state, dispatch] = useReducer((s: AppState, e: AppEvent) => transition(s, e), "menu" as AppState);
  // Keys can arrive faster than React re-renders, so key handling reads the
  // state machine from this ref, which every transition updates immediately.
  const stateRef = useRef<AppState>("menu");
  const go = useCallback((event: AppEvent) => {
    stateRef.current = transition(stateRef.current, event);
    dispatch(event);
  }, []);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [message, setMessage] = useState("");
  const [chart, setChart] = useState<ChartOps | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const chartRef = useRef<ChartOps | null>(null);
  chartRef.current = chart;
  const input = useRef<HTMLInputElement>(null);
  const mic = useRef<PushToTalk | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const pressedAt = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const conversation = useRef<{ history: TurnResult["history"]; state: TurnState }>({ history: [], state: {} });
  const [lessons, setLessons] = useState<LessonInfo[]>(DEFAULT_LESSONS);
  const items = trayItems(lessons);
  const itemsRef = useRef<TrayItem[]>(items);
  itemsRef.current = items;
  const [picked, setPicked] = useState<number | null>(null);
  const pickRef = useRef<number | null>(null);
  const tipPending = useRef(false);
  const [menuId, setMenuId] = useState<MenuId>("main");
  const menuIdRef = useRef<MenuId>("main");
  const [lessonView, setLessonView] = useState<StepView | null>(null);
  const [quizView, setQuizView] = useState<QuizView | null>(null);
  const quizRef = useRef<QuizView | null>(null);
  const nextLessonRef = useRef<string | null>(null);
  const [palmStatus, setPalmStatus] = useState<PalmStatus>("idle");
  const [soundPlaying, setSoundPlaying] = useState(false);
  const [proposal, setProposal] = useState<TradeProposal | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [clock, setClock] = useState(0);
  const [expired, setExpired] = useState(false);
  const [tradeResult, setTradeResult] = useState<TradeResult | null>(null);
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  settingsRef.current = settings;
  const [gemini, setGemini] = useState<GeminiOption | null>(null);
  const arm = useRef<PalmArm | null>(null);
  const [armState, setArmState] = useState<ArmState>("disconnected");
  const armConnected = armState !== "disconnected" && armState !== "connecting";
  const [armProgress, setArmProgress] = useState<{ drawn: number; total: number } | null>(null);
  const [armLog, setArmLog] = useState<string[]>([]);
  const armJob = useRef<DrawJob | null>(null);
  // ?arm=mock (or localStorage sonar-arm-mock=1) tests the whole flow without hardware.
  const [armMock, setArmMock] = useState(false);
  const [armSupported, setArmSupported] = useState(false);
  const resetArmedAt = useRef(0);
  const menu = buildMenu(menuId, {
    lessons, settings, armConnected, gemini,
    armSupported: armSupported || armMock,
  });

  const choose = useCallback((key: number | null) => {
    pickRef.current = key;
    setPicked(key);
  }, []);

  const interrupt = useCallback(() => {
    pressedAt.current = null;
    request.current?.abort();
    mic.current?.cancel();
    speaker.current?.stop();
    stopSonify();
    choose(null);
  }, [choose]);

  /** The first time the tray opens, the tutor reads two suggestions once speech is free. */
  const speakTipIfPending = useCallback(() => {
    if (!tipPending.current) return;
    tipPending.current = false;
    speaker.current ??= new Speaker();
    void speaker.current.speak(trayTip(itemsRef.current), loadSettings().speed);
  }, []);

  /** Speak tutor text (menus, settings confirmations, help). */
  const say = useCallback((text: string, speed = settingsRef.current.speed) => {
    speaker.current ??= new Speaker();
    return speaker.current.speak(text, speed);
  }, []);

  /** Draw a chart on the physical arm, one W line per segment. A new chart replaces the old one. */
  const drawOnArm = useCallback((c: ChartOps | null) => {
    const a = arm.current;
    armJob.current?.cancel();
    if (!c || !a || (a.state !== "ready" && a.state !== "busy")) return;
    const segments = chartSegments(c);
    if (!segments.length) return;
    setArmProgress({ drawn: 0, total: segments.length });
    const job = drawSegments(a, segments, (drawn, total) => {
      if (armJob.current === job) setArmProgress({ drawn, total });
    });
    armJob.current = job;
    void job.done.then(() => {
      if (armJob.current === job) { armJob.current = null; setArmProgress(null); }
    });
  }, []);

  const connectArm = useCallback(async () => {
    const a = (arm.current ??= new PalmArm());
    a.onState = setArmState;
    if (!a.connected) {
      a.onLog((m) => setArmLog((l) => [...l.slice(-7), m.replace(/^send: /, "")].filter((x) => !x.startsWith("arm: "))));
    }
    try {
      const transport = armMock ? new MockTransport(600) : new WebSerialTransport(await chooseSerialPort());
      setMessage(armMock ? "Connecting the mock arm…" : "Connecting the palm arm… the board restarts, this takes a few seconds.");
      await a.connect(transport);
      setMessage(armMock ? "Mock arm connected." : "Palm arm connected.");
      void say(armMock ? "Mock arm connected." : "Palm arm connected. Charts will be drawn on your palm.");
    } catch (err) {
      const why = (err as Error).message;
      if ((err as Error).name === "NotFoundError") { setMessage("No port chosen."); return; } // picker cancelled
      setMessage(`The palm arm didn't connect. ${why}`);
      void say("The palm arm didn't connect. Check the USB cable, and close the Arduino Serial Monitor.");
    }
  }, [armMock, say]);

  const disconnectArm = useCallback(async () => {
    armJob.current?.cancel();
    await arm.current?.disconnect();
    setArmProgress(null);
    setMessage("Palm arm disconnected.");
    void say("Palm arm disconnected. Charts will play as sound.");
  }, [say]);

  /** Emergency stop: X goes out at once; the arm stays limp until Resume. */
  const stopArm = useCallback(async () => {
    armJob.current?.cancel();
    armJob.current = null;
    setArmProgress(null);
    if (!arm.current?.connected) return;
    await arm.current.stop().catch(() => {});
    setMessage("Arm stopped. Press Resume arm to turn it back on.");
    void say("Arm stopped.");
  }, [say]);

  const resumeArm = useCallback(async () => {
    try {
      await arm.current?.resume();
      setMessage("Arm resumed.");
    } catch (err) {
      setMessage(`The arm didn't resume. ${(err as Error).message}`);
    }
  }, []);

  const traceArmBox = useCallback(async () => {
    try {
      setMessage("Tracing the drawing box. Rest your hand where the arm moves.");
      await arm.current?.traceBox();
      setMessage("Box traced.");
    } catch (err) {
      setMessage(`The arm couldn't trace the box. ${(err as Error).message}`);
    }
  }, []);

  /** Play the current chart as rising and falling tones. */
  const playChart = useCallback(async (c: ChartOps | null) => {
    if (!c) return;
    setSoundPlaying(true);
    try {
      await sonify(c);
    } finally {
      setSoundPlaying(false);
    }
  }, []);

  /** Stop whatever is in flight and start a fresh request. */
  const fresh = useCallback(() => {
    interrupt();
    const controller = new AbortController();
    request.current = controller;
    return controller;
  }, [interrupt]);

  const fallback = useCallback((reason: string) => {
    setMessage(reason);
    setTyping(true);
    go({ type: "MENU" });
  }, []);

  /** Show and speak a tutor result, from either /api/talk or /api/action. */
  const applyResult = useCallback((result: TurnResult, controller: AbortController) => {
    if (typeof result.reply !== "string" || !result.reply.trim()) throw new Error("Empty reply");
    // History only comes back from free-form turns; UI actions keep the existing conversation.
    conversation.current = {
      history: result.history?.length ? result.history : conversation.current.history,
      state: result.state ?? {},
    };
    const view = answerView(result.directives ?? [], quizRef.current);
    // A filled trade is felt as a single tap (unless the lesson step draws its own shape).
    setChart(view.trade && !view.chart ? SINGLE_TAP : view.chart);
    const offer = view.proposal as TradeProposal | null;
    setProposal(offer);
    setExpired(false);
    if (offer) {
      const now = Date.now();
      setDeadline(offerDeadline(offer, now));
      setClock(now);
    }
    setTradeResult(view.trade as TradeResult | null);
    if (!offer && !view.trade) { setHistory(null); setPortfolio(null); }
    // Results-panel data: the last month of prices, and the account after a fill.
    const symbol = offer?.symbol ?? (view.trade as TradeResult | null)?.trade.symbol;
    if (symbol) {
      fetch(`/api/market?kind=history&symbol=${encodeURIComponent(symbol)}&range=1m`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => { if (Array.isArray(body?.points)) setHistory(body.points); })
        .catch(() => {});
    }
    const account: Promise<Portfolio | null> = view.trade
      ? fetch("/api/market?kind=portfolio").then((r) => (r.ok ? r.json() : null)).catch(() => null)
      : Promise.resolve(null);
    void account.then((p) => { if (p) setPortfolio(p); });
    setPlayKey((key) => key + 1);
    setPalmStatus("idle");
    setReply(result.reply);
    setLessonView(view.lesson);
    quizRef.current = view.quiz;
    setQuizView(view.quiz);
    nextLessonRef.current = view.nextLessonId;
    go({ type: "REPLY_READY", kind: view.kind });
    // Drawings go to the palm arm too when it's connected.
    drawOnArm(view.trade && !view.chart ? SINGLE_TAP : view.chart);
    const quiz = result.directives?.find((directive) => directive.type === "quiz_result");
    if (quiz?.type === "quiz_result") {
      earcon(quiz.result.correct ? "success" : "wrong");
      if (quiz.result.correct) {
        markDone(quiz.lessonId);
        setLessons((ls) => mergeDone(ls, loadDone()));
      }
    }
    if (result.directives?.some((directive) => directive.type === "settled")) earcon("trade");
    const options = result.directives?.find((directive) => directive.type === "options");
    if (options?.type === "options" && options.options[0]) setGemini(options.options[0]);
    speaker.current ??= new Speaker();
    const drawn = view.trade && !view.chart ? SINGLE_TAP : view.chart;
    void Promise.all([speaker.current.speak(result.reply, loadSettings().speed), account]).then(async ([, p]) => {
      const current = () => request.current === controller && !controller.signal.aborted;
      if (!current()) return;
      // Then the chart as sound, so tones never talk over the tutor.
      if (drawn && shouldAutoSonify(loadSettings(), !!arm.current?.connected)) await playChart(drawn);
      if (!current()) return;
      if (p?.tip) void speaker.current?.speak(`Habit tip: ${p.tip}`, loadSettings().speed);
      else speakTipIfPending();
    });
  }, [speakTipIfPending, playChart, drawOnArm]);

  const send = useCallback(async (question: string, controller: AbortController) => {
    if (controller.signal.aborted) return;
    setTranscript(question);
    setMessage("");
    setTyping(false);
    go({ type: "THINK" });
    try {
      const response = await fetch("/api/talk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: question, ...conversation.current }), signal: controller.signal,
      });
      if (!response.ok) throw new Error("Tutor unavailable");
      const result: TurnResult = await response.json();
      if (controller.signal.aborted) return;
      applyResult(result, controller);
    } catch {
      if (!controller.signal.aborted) fallback("I couldn't reach the tutor. Try again, or type your question.");
    }
  }, [fallback, applyResult]);

  /** Deterministic UI actions (no model call), e.g. starting a lesson from the tray. */
  const act = useCallback(async (action: UiAction, label: string, controller: AbortController) => {
    if (controller.signal.aborted) return;
    setTranscript(label);
    setMessage("");
    setTyping(false);
    go({ type: "THINK" });
    try {
      const response = await fetch("/api/action", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, state: conversation.current.state }), signal: controller.signal,
      });
      if (!response.ok) throw new Error("Action failed");
      const result: TurnResult = await response.json();
      if (controller.signal.aborted) return;
      applyResult(result, controller);
    } catch {
      if (!controller.signal.aborted) fallback("Something went wrong. Try again, or type your question.");
    }
  }, [fallback, applyResult]);

  /** Run a tray suggestion: lessons go straight to the lesson engine, questions to the tutor. */
  const runPick = useCallback((item: TrayItem, controller: AbortController) => {
    if (item.cmd.kind === "lesson") void act({ type: "start_lesson", lesson: item.cmd.lesson }, item.label, controller);
    else void send(item.cmd.text, controller);
  }, [act, send]);

  const start = useCallback(async () => {
    if (state === "settling" || pressedAt.current !== null) return;
    interrupt();
    const controller = new AbortController();
    request.current = controller;
    pressedAt.current = performance.now();
    setTyping(false);
    setMessage("");
    go({ type: "TALK_START" });
    earcon("listen-start");
    if (!flag(TRAY_TIP_FLAG)) {
      setFlag(TRAY_TIP_FLAG);
      tipPending.current = true;
    }
    mic.current ??= new PushToTalk();
    const ready = await mic.current.start();
    if (!controller.signal.aborted && !ready && pressedAt.current !== null) {
      pressedAt.current = null;
      fallback("Microphone unavailable. You can type your question instead.");
    }
  }, [state, interrupt, fallback]);

  const end = useCallback(async () => {
    if (pressedAt.current === null) return;
    const heldMs = performance.now() - pressedAt.current;
    pressedAt.current = null;
    const controller = request.current;
    earcon("listen-end");
    // A number picked from the tray wins over speech, however short the hold.
    const item = pickRef.current !== null ? trayPick(itemsRef.current, pickRef.current) : undefined;
    choose(null);
    if (item && controller && !controller.signal.aborted) {
      mic.current?.cancel();
      go({ type: "TALK_END", heldMs: Math.max(heldMs, MIN_HOLD_MS) });
      runPick(item, controller);
      return;
    }
    go({ type: "TALK_END", heldMs });
    if (heldMs < MIN_HOLD_MS) {
      mic.current?.cancel();
      controller?.abort();
      speakTipIfPending();
      return;
    }
    const clip = await mic.current?.stop();
    if (!controller || controller.signal.aborted) return;
    if (!clip) {
      fallback("No audio was recorded. Hold Space to try again, or type your question.");
      return;
    }
    const result = await transcribe(clip, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) fallback(result.message!);
    else await send(result.text, controller);
  }, [fallback, send, choose, runPick, speakTipIfPending]);

  /** Open a menu and read it aloud. The first menu of a visit starts with the welcome. */
  const welcomed = useRef(false);
  const openMenu = useCallback((id: MenuId, intro?: string) => {
    const next = buildMenu(id, {
      lessons, settings: settingsRef.current, armConnected, gemini,
      armSupported: armSupported || armMock,
    });
    menuIdRef.current = id;
    setMenuId(id);
    setTyping(false);
    go({ type: "MENU" });
    const lead = intro ?? (!welcomed.current && id === "main" ? WELCOME : undefined);
    welcomed.current = true;
    void say(speakMenu(next).replace(/^Main menu\. /, lead ? `${lead} ` : "Main menu. "));
  }, [lessons, armConnected, armSupported, armMock, gemini, say]);

  const replay = useCallback(() => {
    if (state === "listening" || state === "thinking") return;
    // R before anything was said repeats the welcome.
    if (!speaker.current?.last) { openMenu("main"); return; }
    void repeat(speaker.current, () => { setPlayKey((key) => key + 1); drawOnArm(chartRef.current); }, loadSettings().speed).then((ok) => {
      if (ok && shouldAutoSonify(loadSettings(), !!arm.current?.connected)) void playChart(chartRef.current);
    });
  }, [state, openMenu, playChart, drawOnArm]);

  /** Settings changes are saved, applied, shown, and spoken at the new speed. */
  const changeSetting = useCallback(async (key: "speed" | "chartSounds" | "textSize" | "arm" | "reset") => {
    if (key === "arm") {
      if (!webSerialSupported() && !armMock) {
        setMessage("The palm arm needs Chrome or Edge.");
        void say("The palm arm needs Chrome or Edge, which can talk to it over USB.");
        return;
      }
      if (arm.current?.connected) await disconnectArm();
      else await connectArm();
      return;
    }
    if (key === "reset") {
      const now = Date.now();
      if (now - resetArmedAt.current > RESET_CONFIRM_MS) {
        resetArmedAt.current = now;
        setMessage("Press 5 again to reset all lesson progress.");
        void say("This erases your lesson progress. Press 5 again to confirm.");
        return;
      }
      resetArmedAt.current = 0;
      try {
        const r = await fetch("/api/progress", { method: "DELETE" });
        if (!r.ok) throw new Error();
        const body = await (await fetch("/api/progress")).json().catch(() => null);
        clearDone();
        if (Array.isArray(body?.lessons)) setLessons(body.lessons);
        setMessage("Lesson progress is reset.");
        void say("Lesson progress is reset.");
      } catch {
        setMessage("I couldn't reset progress right now.");
        void say("I couldn't reset progress right now.");
      }
      return;
    }
    const { settings: next, say: spoken } = toggleSetting(settingsRef.current, key);
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
    applyTextSize(next.textSize);
    setMessage(spoken);
    void say(spoken, next.speed);
  }, [say, armMock, connectArm, disconnectArm]);

  /** Run a menu command. */
  const run = useCallback((cmd: Command, label: string) => {
    resetArmedAt.current = cmd.kind === "setting" && cmd.key === "reset" ? resetArmedAt.current : 0;
    switch (cmd.kind) {
      case "submenu": interrupt(); setMessage(""); openMenu(cmd.id); break;
      case "lesson": void act({ type: "start_lesson", lesson: cmd.lesson }, label, fresh()); break;
      case "ask":
        if (gemini && cmd.text === gemini.say) setGemini(null);
        void send(cmd.text, fresh());
        break;
      case "tool": void act({ type: "tool", name: cmd.name, args: cmd.args }, label, fresh()); break;
      case "setting": interrupt(); void changeSetting(cmd.key); break;
      case "help": {
        interrupt();
        setTranscript("Help");
        setReply(HELP);
        go({ type: "THINK" });
        go({ type: "REPLY_READY", kind: "answer" });
        void say(HELP);
        break;
      }
    }
  }, [interrupt, openMenu, act, fresh, send, changeSetting, gemini, say]);

  const chooseMenu = useCallback((n: number) => {
    const current = buildMenu(menuIdRef.current, {
      lessons, settings: settingsRef.current, armConnected, gemini, armSupported: armSupported || armMock,
    });
    const choice = menuChoice(current, n);
    if (choice === "back") { interrupt(); setMessage(""); openMenu("main"); }
    else if (choice) run(choice.cmd, choice.label);
  }, [lessons, armConnected, armSupported, armMock, gemini, run, interrupt, openMenu]);

  const handle = useCallback((action: KeyAction) => {
    const state = stateRef.current;
    switch (action.type) {
      case "talk-start": void start(); break;
      case "talk-end": void end(); break;
      case "repeat": replay(); break;
      case "type":
        interrupt(); setMessage(""); setTyping(true); go({ type: "MENU" }); break;
      case "menu":
        interrupt(); setMessage(""); openMenu("main"); break;
      case "escape":
        if (state === "confirm") { void act({ type: "cancel" }, "", fresh()); break; }
        interrupt(); setTyping(false); setMessage("");
        go({ type: state === "thinking" ? "MENU" : "CANCEL" }); break;
      case "digit":
        // While space is held, 1-9 pick a Try asking suggestion (sent on release).
        if (pressedAt.current !== null) {
          if (action.n >= 1 && trayPick(itemsRef.current, action.n)) choose(action.n);
        } else if (state === "menu" && !typing) {
          chooseMenu(action.n);
        } else if (state === "quiz" && quizRef.current && action.n >= 1 && action.n <= quizRef.current.options.length) {
          void act({ type: "quiz_answer", choice: action.n }, `Answer ${action.n}`, fresh());
        } else if (action.n === 0) { interrupt(); setMessage(""); openMenu("main"); }
        break;
      case "stop-arm":
        void stopArm();
        break;
      case "sonify":
        // S plays the current chart as sound (it stops any chart already playing).
        if (chartRef.current && state !== "listening") { speaker.current?.stop(); void playChart(chartRef.current); }
        break;
      case "next":
        if (state === "lesson") void act({ type: "next" }, lessonView?.lessonTitle ?? "Next step", fresh());
        else if (state === "quiz" && quizRef.current?.result?.correct && nextLessonRef.current) {
          void act({ type: "start_lesson", lesson: nextLessonRef.current }, "Next lesson", fresh());
        }
        break;
      case "prev":
        if (state === "lesson") void act({ type: "prev" }, lessonView?.lessonTitle ?? "Previous step", fresh());
        break;
      case "confirm":
        if (state !== "confirm") break;
        if (expired && proposal) {
          void act({ type: "tool", name: "propose_trade",
            args: { side: proposal.side, symbol: proposal.symbol, quantity: proposal.quantity } }, "", fresh());
        } else void act({ type: "confirm" }, "", fresh());
        break;
    }
  }, [start, end, replay, interrupt, state, choose, typing, chooseMenu, openMenu, act, fresh, lessonView, expired, proposal, playChart, stopArm]);

  // Mock mode and Web Serial support are only known in the browser.
  useEffect(() => {
    setArmSupported(webSerialSupported());
    setArmMock(new URLSearchParams(window.location.search).get("arm") === "mock" || flag("arm-mock"));
  }, []);

  // The 60-second offer clock. When it runs out, say so once.
  useEffect(() => {
    if (state !== "confirm" || !proposal || expired) return;
    const tick = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= deadline) {
        setExpired(true);
        setMessage("");
        void say("That offer expired. Want me to quote it again? Press Enter for a new price.");
      }
    }, 250);
    return () => clearInterval(tick);
  }, [state, proposal, expired, deadline, say]);

  // Saved settings: speed, chart sounds, text size.
  useEffect(() => {
    const saved = loadSettings();
    settingsRef.current = saved;
    setSettings(saved);
    applyTextSize(saved.textSize);
  }, []);

  // Lesson tags (Done / Up next) for the tray. Defaults stay if the API is unreachable.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/progress", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const base = Array.isArray(body?.lessons) && body.lessons.length ? body.lessons : DEFAULT_LESSONS;
        setLessons(mergeDone(base, loadDone()));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Keys always reach the newest handler: the ref is updated during render,
  // so a key pressed right after a state change never sees stale state.
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const interruptRef = useRef(interrupt);
  interruptRef.current = interrupt;

  useEffect(() => {
    const handle = (action: KeyAction) => handleRef.current(action);
    const interrupt = () => interruptRef.current();
    const down = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) {
        if (event.key === "Escape") { event.preventDefault(); handle({ type: "escape" }); focusSpaceBar(); }
        return;
      }
      // Let Enter activate ordinary buttons and submit the typing form.
      // The space bar keeps focus, so Enter there means "confirm", not "press this button".
      if (event.key === "Enter" && target?.closest("button:not(.spacebar)")) return;
      const action = keyDownAction(event);
      if (action) { event.preventDefault(); handle(action); }
    };
    const up = (event: KeyboardEvent) => {
      const action = keyUpAction(event);
      if (action && pressedAt.current !== null) { event.preventDefault(); handle(action); }
    };
    const blur = () => {
      if (pressedAt.current !== null) { interrupt(); go({ type: "TALK_CANCEL" }); }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => () => interrupt(), [interrupt]);
  useEffect(() => { if (typing) input.current?.focus(); }, [typing]);
  // Every caption is mirrored to the live region; other states announce their heading.
  useEffect(() => {
    const captioned = state === "answer" || state === "lesson" || state === "quiz" || state === "confirm";
    announce(message || (captioned && reply ? reply : HEADINGS[state]));
  }, [state, message, reply]);

  return (
    <main
      className="shell"
      data-state={state}
      role="application"
      aria-label="Sonar investing tutor"
      aria-describedby="sonar-keys"
    >
      <p id="sonar-keys" className="sr-only">
        Hold space to talk and let go to send. Numbers pick options. M opens the menu, R repeats, N and P move
        through lesson steps, S plays a chart as sound, Enter confirms, Escape cancels, and T types a question.
      </p>
      <AuroraBackground listening={state === "listening"} />
      <h1 className="heading">{HEADINGS[state]}</h1>
      <SpaceBar
        listening={state === "listening"}
        disabled={state === "settling"}
        onPress={() => void start()}
        onRelease={() => void end()}
        onCancel={() => { interrupt(); go({ type: "TALK_CANCEL" }); }}
        isHeld={() => pressedAt.current !== null}
      />
      <TryAskingTray
        open={state === "listening"}
        items={items}
        picked={picked}
        onPick={(key) => { if (pressedAt.current !== null) choose(picked === key ? null : key); }}
      />
      {message && <p className="voice-message">{message}</p>}
      {state !== "menu" && state !== "listening" && (transcript || reply) && (
        <AnswerCard
          asked={transcript}
          thinking={state === "thinking"}
          reply={reply}
          chart={state === "thinking" ? null : chart}
          playKey={playKey}
          palmStatus={palmStatus}
          armStatus={armProgress ? armStatusText("busy", armMock, armProgress) : null}
          soundPlaying={soundPlaying}
          armConnected={armConnected}
          lesson={state === "lesson" || state === "confirm" ? lessonView : null}
          quiz={state === "quiz" ? quizView : null}
          onPalmStatus={setPalmStatus}
          onPrev={() => { handle({ type: "prev" }); focusSpaceBar(); }}
          onNext={() => { handle({ type: "next" }); focusSpaceBar(); }}
          onAnswer={(n) => { handle({ type: "digit", n }); focusSpaceBar(); }}
        >
          {state === "confirm" && proposal && (
            <>
              <ConfirmPanel
                proposal={proposal}
                secondsLeft={secondsLeft(deadline, clock)}
                expired={expired}
                onConfirm={() => { handle({ type: "confirm" }); focusSpaceBar(); }}
                onCancel={() => { handle({ type: "escape" }); focusSpaceBar(); }}
              />
              {hasDetails(proposal) && <TradeResults result={null} preview={proposal} history={history} portfolio={null} />}
            </>
          )}
          {state === "settling" && tradeResult && (
            <SettlingChecklist settlement={tradeResult.settlement}
              onDone={() => go({ type: "SETTLED", to: lessonView ? "lesson" : "answer" })} />
          )}
          {(state === "answer" || state === "lesson") && tradeResult && (
            <TradeResults result={tradeResult} history={history} portfolio={portfolio} />
          )}
        </AnswerCard>
      )}
      {state === "menu" && !typing && <OptionsMenu menu={menu} onChoose={(n) => { chooseMenu(n); focusSpaceBar(); }} />}
      {typing && (
        <form className="typing-form" onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          interrupt();
          const controller = new AbortController();
          request.current = controller;
          void send(text.trim(), controller);
          setText("");
          focusSpaceBar();
        }}>
          <label htmlFor="question">Type your question</label>
          <input ref={input} id="question" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} required />
          <button type="submit">Send question</button>
        </form>
      )}
      <ArmControls
        state={armState}
        mock={armMock}
        supported={armSupported}
        progress={armProgress}
        log={armLog}
        onConnect={() => { void connectArm(); }}
        onDisconnect={() => { void disconnectArm(); focusSpaceBar(); }}
        onStop={() => { void stopArm(); focusSpaceBar(); }}
        onResume={() => { void resumeArm(); focusSpaceBar(); }}
        onTraceBox={() => { void traceArmBox(); focusSpaceBar(); }}
      />
      <BottomDock
        hidden={state === "listening"}
        canRepeat={state !== "thinking"}
        onMenu={() => { handle({ type: "menu" }); focusSpaceBar(); }}
        onRepeat={() => { replay(); focusSpaceBar(); }}
        onType={() => handle({ type: "type" })}
      />
    </main>
  );
}
