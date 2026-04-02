
//  CAPTAIN'S LOG — Frontend ↔ Backend 

import { useState, useEffect, useCallback, useRef } from "react";
import { getLog, getAllLogs, saveLog, getStreak } from "./api/logs";

// ─── UTILITIES ──────────────────────────────────────────────
function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}
function getDateKey(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}
function formatKey(key) {
  return new Date(key + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}
function isComplete(entry) {
  return entry?.checks && Object.values(entry.checks).filter(Boolean).length === 4;
}
function checksCount(entry) {
  return Object.values(entry?.checks || {}).filter(Boolean).length;
}

// ─── HOOK: useLocalStorage ───────────────────────────────────
// Unchanged from Step 2 — still used as a fast local cache
function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue];
}

// ─── HOOK: useDailyLog (UPGRADED) ────────────────────────────
//
//  What changed:
//  - On mount: loads today's log from the API (merges with cache)
//  - On change: saves to localStorage immediately (instant feedback)
//  - On change: also saves to API after 800ms debounce (real persistence)
//  - Exposes syncStatus: "idle" | "saving" | "saved" | "offline"
//
const EMPTY_LOG = {
  mission:"", codingLearned:"", codingBuilt:"",
  moneyMoves:"", communication:"", timeWasted:"",
  wins:"", improvements:"", tomorrowFocus:"",
};
const EMPTY_CHECKS = { coded:false, spoke:false, money:false, distraction:false };

function useDailyLog() {
  const todayKey = getTodayKey();

  // localStorage cache — stays in sync as a backup
  const [cache, setCache] = useLocalStorage("captains-log-history", {});
  const cachedToday = cache[todayKey] || { log: EMPTY_LOG, checks: EMPTY_CHECKS, submitted: false };

  // Live React state — what the UI reads from
  const [log, setLog]             = useState(cachedToday.log);
  const [checks, setChecks]       = useState(cachedToday.checks);
  const [submitted, setSubmitted] = useState(cachedToday.submitted);
  const [syncStatus, setSyncStatus] = useState("idle");
  // "idle" = no changes yet
  // "saving" = API call in flight
  // "saved" = last save succeeded
  // "offline" = API unreachable, data safe in localStorage

  // useRef to hold the debounce timer between renders
  // (we use ref not state because changing it shouldn't re-render)
  const debounceTimer = useRef(null);

  // ── On mount: fetch today's log from API ─────────────────
  // If the server has newer data than our cache, use the server's
  useEffect(() => {
    async function loadFromServer() {
      const { data, error } = await getLog(todayKey);
      if (error) {
        setSyncStatus("offline");
        return;
      }
      if (data) {
        // Server has data — reshape it to match our frontend shape
        const serverLog = {
          mission:       data.mission       || "",
          codingLearned: data.coding?.learned || "",
          codingBuilt:   data.coding?.built   || "",
          moneyMoves:    data.moneyMoves    || "",
          communication: data.communication || "",
          timeWasted:    data.timeWasted    || "",
          wins:          data.wins          || "",
          improvements:  data.improvements  || "",
          tomorrowFocus: data.tomorrowFocus || "",
        };
        setLog(serverLog);
        setChecks(data.checks || EMPTY_CHECKS);
        setSubmitted(data.submitted || false);
      }
    }
    loadFromServer();
  }, []); // [] = only runs once when the component first mounts

  // ── Sync to localStorage + trigger debounced API save ────
  useEffect(() => {
    // 1. Always update localStorage cache immediately
    setCache(prev => ({ ...prev, [todayKey]: { log, checks, submitted } }));

    // 2. Debounce the API call — wait 800ms after the LAST change
    //    This prevents firing a request on every single keystroke
    setSyncStatus("saving");
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      const payload = {
        mission:       log.mission,
        coding: {
          learned: log.codingLearned,
          built:   log.codingBuilt,
        },
        checks,
        moneyMoves:    log.moneyMoves,
        communication: log.communication,
        timeWasted:    log.timeWasted,
        wins:          log.wins,
        improvements:  log.improvements,
        tomorrowFocus: log.tomorrowFocus,
        submitted,
      };

      const { error } = await saveLog(todayKey, payload);

      if (error) {
        setSyncStatus("offline");
      } else {
        setSyncStatus("saved");
        // After 2 seconds, go back to idle
        setTimeout(() => setSyncStatus("idle"), 2000);
      }
    }, 800); // 800ms debounce

    // Cleanup: if this effect re-runs before 800ms, cancel the old timer
    return () => clearTimeout(debounceTimer.current);
  }, [log, checks, submitted]);

  return {
    log, checks, submitted, syncStatus,
    updateLog:   (f) => (v) => setLog(p => ({ ...p, [f]: v })),
    toggleCheck: (id) => setChecks(p => ({ ...p, [id]: !p[id] })),
    submitLog:   () => setSubmitted(true),
    editLog:     () => setSubmitted(false),
  };
}

// ─── HOOK: useHistory (NEW) ───────────────────────────────────
//
//  Loads ALL log history from the API when the app starts.
//  Falls back to localStorage cache if the server is unreachable.
//
function useHistory() {
  const [cache]  = useLocalStorage("captains-log-history", {});
  const [history, setHistory] = useState(cache); // start with cache instantly
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await getAllLogs();
      if (!error && data) {
        // Reshape the array from the API into the same
        // { "2025-01-15": { log, checks, submitted } } shape
        // that our dashboard and weekly review components expect
        const shaped = {};
        for (const entry of data) {
          shaped[entry.date] = {
            submitted: entry.submitted,
            checks: entry.checks,
            log: {
              mission:       entry.mission,
              codingLearned: entry.coding?.learned || "",
              codingBuilt:   entry.coding?.built   || "",
              moneyMoves:    entry.moneyMoves,
              communication: entry.communication,
              timeWasted:    entry.timeWasted,
              wins:          entry.wins,
              improvements:  entry.improvements,
              tomorrowFocus: entry.tomorrowFocus,
            },
          };
        }
        setHistory(shaped);
      }
      // If error, we already have cache as the fallback
      setLoading(false);
    }
    load();
  }, []);

  return { history, loading };
}

// ─── HOOK: useStreakFromAPI (NEW) ─────────────────────────────
//
//  Fetches the streak from the server (which calculates it from
//  the full MongoDB history). Falls back to local calculation.
//
function useStreakFromAPI(history) {
  // Local streak calculation as instant fallback
  const localStreak = useCallback(() => {
    let count = 0;
    for (let i = 1; i <= 365; i++) {
      const key = getDateKey(i);
      if (isComplete(history[key])) count++;
      else break;
    }
    return count;
  }, [history]);

  const [streak, setStreak] = useState(localStreak);

  useEffect(() => {
    async function fetchStreak() {
      const { streak: s, error } = await getStreak();
      if (!error) setStreak(s);
    }
    fetchStreak();
  }, []);

  return streak;
}

// ─── ICONS ──────────────────────────────────────────────────
const Icons = {
  Terminal:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  DollarSign:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  MessageSquare: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  Shield:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Star:          () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  Target:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Flame:         () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>,
  Check:         () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>,
  Rocket:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m3.5 11.5 1 4.5 4.5 1L21 4z"/></svg>,
  Edit:          () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Grid:          () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  Book:          () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  BarChart:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  AlertCircle:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  TrendingUp:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  Calendar:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  WifiOff:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  Loader:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>,
};

// ─── SYNC STATUS INDICATOR ───────────────────────────────────
function SyncBadge({ status }) {
  if (status === "idle")    return null;
  if (status === "saving")  return <span className="flex items-center gap-1 text-[10px] text-zinc-600"><Icons.Loader /> Saving…</span>;
  if (status === "saved")   return <span className="text-[10px] text-emerald-600 transition-opacity">Saved ✓</span>;
  if (status === "offline") return (
    <span className="flex items-center gap-1 text-[10px] text-amber-600">
      <Icons.WifiOff /> Offline — saved locally
    </span>
  );
  return null;
}

// ─── OFFLINE BANNER ──────────────────────────────────────────
function OfflineBanner() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
      <span className="text-amber-400 flex-shrink-0"><Icons.WifiOff /></span>
      <div>
        <div className="text-amber-300 text-xs font-semibold">Backend not reachable</div>
        <div className="text-zinc-500 text-[10px] mt-0.5">
          Your data is being saved locally. Start the server with <code className="bg-zinc-800 px-1 rounded">npm run dev</code> in the backend folder.
        </div>
      </div>
    </div>
  );
}

// ─── SHARED UI ───────────────────────────────────────────────
function Section({ icon: Icon, label, accent, children }) {
  const border = { blue:"border-blue-500/20 focus-within:border-blue-500/50", green:"border-green-500/20 focus-within:border-green-500/50", violet:"border-violet-500/20 focus-within:border-violet-500/50", red:"border-red-500/20 focus-within:border-red-500/50", amber:"border-amber-500/20 focus-within:border-amber-500/50", sky:"border-sky-500/20 focus-within:border-sky-500/50" };
  const color  = { blue:"text-blue-400", green:"text-green-400", violet:"text-violet-400", red:"text-red-400", amber:"text-amber-400", sky:"text-sky-400" };
  return (
    <div className={`rounded-xl border bg-zinc-900/60 transition-all duration-300 ${border[accent]}`}>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <span className={color[accent]}><Icon /></span>
        <span className="text-xs font-semibold tracking-widest uppercase text-zinc-400">{label}</span>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3, disabled }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      rows={rows} disabled={disabled}
      className="w-full bg-transparent text-zinc-200 placeholder-zinc-700 text-sm leading-relaxed resize-none outline-none font-mono disabled:opacity-60" />
  );
}

const CHECKS_DEF = [
  { id:"coded",       label:"I coded today" },
  { id:"spoke",       label:"I spoke to someone" },
  { id:"money",       label:"I tried to earn money" },
  { id:"distraction", label:"I controlled distractions" },
];

function Checklist({ checks, onChange, disabled }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {CHECKS_DEF.map(({ id, label }) => {
        const checked = checks[id];
        return (
          <button key={id} onClick={() => !disabled && onChange(id)} disabled={disabled}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all duration-200 group
              ${checked ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"}
              ${disabled ? "opacity-60 cursor-default" : "cursor-pointer"}`}>
            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-all duration-200
              ${checked ? "bg-emerald-500 border-emerald-500" : "border-zinc-700 group-hover:border-zinc-500"}`}>
              {checked && <Icons.Check />}
            </div>
            <span className="text-sm font-medium">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  PAGE 1 — DAILY LOG
// ════════════════════════════════════════════════════════════
function DailyLogPage({ dailyLog }) {
  const { log, checks, submitted, syncStatus, updateLog, toggleCheck, submitLog, editLog } = dailyLog;
  const completedChecks = Object.values(checks).filter(Boolean).length;
  const completionPct   = Math.round((completedChecks / 4) * 100);
  const readOnly        = submitted;

  return (
    <div className="space-y-5">

      {/* Offline warning */}
      {syncStatus === "offline" && <OfflineBanner />}

      {/* Progress row */}
      <div className="flex items-center justify-between px-1">
        <SyncBadge status={syncStatus} />
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-500"
              style={{ width: `${completionPct}%` }} />
          </div>
          <span className="text-xs text-zinc-500 font-mono w-8">{completionPct}%</span>
        </div>
      </div>

      {/* Submitted banner */}
      {submitted && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-emerald-400 font-semibold text-sm">✓ Log submitted for today</div>
            <div className="text-zinc-500 text-xs mt-0.5">Come back tomorrow for a fresh entry.</div>
          </div>
          <button onClick={editLog} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-all">
            <Icons.Edit /> Edit
          </button>
        </div>
      )}

      {/* Mission */}
      <div className={`rounded-xl border bg-zinc-900/60 px-5 py-4 transition-all duration-300 ${readOnly ? "border-zinc-800/40" : "border-zinc-700/50 focus-within:border-zinc-500/70"}`}>
        <div className="text-[10px] tracking-widest uppercase text-zinc-500 mb-2">▸ Mission for today</div>
        <input value={log.mission} onChange={e => updateLog("mission")(e.target.value)} disabled={readOnly}
          placeholder="What is the one thing that must happen today?"
          className="w-full bg-transparent text-white placeholder-zinc-700 text-lg outline-none disabled:opacity-60"
          style={{ fontFamily:"'Syne', sans-serif", fontWeight:700 }} />
      </div>

      {/* Checklist */}
      <div>
        <div className="text-[10px] tracking-widest uppercase text-zinc-600 mb-3 px-1">▸ Daily checklist — {completedChecks}/4 complete</div>
        <Checklist checks={checks} onChange={toggleCheck} disabled={readOnly} />
      </div>

      {/* Sections */}
      <Section icon={Icons.Terminal} label="Coding" accent="blue">
        <div className="space-y-3">
          <div><div className="text-[10px] text-zinc-600 mb-1.5">What I learned</div>
            <Textarea value={log.codingLearned} onChange={updateLog("codingLearned")} placeholder="Concepts, docs, tutorials..." rows={2} disabled={readOnly} /></div>
          <div className="border-t border-zinc-800" />
          <div><div className="text-[10px] text-zinc-600 mb-1.5">What I built</div>
            <Textarea value={log.codingBuilt} onChange={updateLog("codingBuilt")} placeholder="Features, commits, projects..." rows={2} disabled={readOnly} /></div>
        </div>
      </Section>
      <Section icon={Icons.DollarSign} label="Money Moves" accent="green">
        <Textarea value={log.moneyMoves} onChange={updateLog("moneyMoves")} placeholder="Who did you contact? What opportunities did you chase?" rows={3} disabled={readOnly} />
      </Section>
      <Section icon={Icons.MessageSquare} label="Communication" accent="violet">
        <Textarea value={log.communication} onChange={updateLog("communication")} placeholder="Who did you speak to? What did you discuss?" rows={3} disabled={readOnly} />
      </Section>
      <Section icon={Icons.Shield} label="Discipline" accent="red">
        <div className="text-[10px] text-zinc-600 mb-1.5">Time wasted on</div>
        <Textarea value={log.timeWasted} onChange={updateLog("timeWasted")} placeholder="Social media, doomscrolling... Be honest." rows={2} disabled={readOnly} />
      </Section>
      <Section icon={Icons.Star} label="Reflection" accent="amber">
        <div className="space-y-3">
          <div><div className="text-[10px] text-zinc-600 mb-1.5">Wins today</div>
            <Textarea value={log.wins} onChange={updateLog("wins")} placeholder="What went well? Celebrate it." rows={2} disabled={readOnly} /></div>
          <div className="border-t border-zinc-800" />
          <div><div className="text-[10px] text-zinc-600 mb-1.5">What to improve</div>
            <Textarea value={log.improvements} onChange={updateLog("improvements")} placeholder="What would you do differently?" rows={2} disabled={readOnly} /></div>
        </div>
      </Section>
      <Section icon={Icons.Target} label="Tomorrow's Focus" accent="sky">
        <Textarea value={log.tomorrowFocus} onChange={updateLog("tomorrowFocus")} placeholder="What is the #1 priority tomorrow?" rows={2} disabled={readOnly} />
      </Section>

      {!submitted && (
        <button onClick={submitLog} disabled={completedChecks === 0}
          className="w-full py-4 rounded-xl font-bold tracking-widest uppercase text-sm transition-all
            bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500
            text-white shadow-lg shadow-blue-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily:"'Syne', sans-serif" }}>
          {completedChecks === 0 ? "Tick at least one item to submit" : "Submit Today's Log"}
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  PAGE 2 — DASHBOARD
// ════════════════════════════════════════════════════════════
function HeatCell({ count, label }) {
  const bg = count===4?"bg-emerald-500":count===3?"bg-emerald-500/60":count===2?"bg-yellow-500/50":count===1?"bg-orange-500/40":"bg-zinc-800";
  return (
    <div className="group relative">
      <div className={`w-7 h-7 rounded-md ${bg} transition-all group-hover:scale-110 cursor-default`} />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-300 px-2 py-1 rounded whitespace-nowrap z-10">
        {label}: {count}/4
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  const colors = { blue:"from-blue-500/10 to-blue-500/5 border-blue-500/20 text-blue-400", emerald:"from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 text-emerald-400", orange:"from-orange-500/10 to-orange-500/5 border-orange-500/20 text-orange-400", violet:"from-violet-500/10 to-violet-500/5 border-violet-500/20 text-violet-400" };
  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 ${colors[accent]}`}>
      <div className="text-[10px] tracking-widest uppercase text-zinc-500 mb-2">{label}</div>
      <div className="text-3xl font-bold text-white font-mono">{value}</div>
      {sub && <div className="text-xs text-zinc-600 mt-1">{sub}</div>}
    </div>
  );
}

function DashboardPage({ history, streak, checks, submitted, loading, onGoToLog }) {
  const last28 = Array.from({ length:28 }, (_, i) => { const key=getDateKey(27-i); return { key, count:checksCount(history[key]), label:formatKey(key) }; });
  const last7  = Array.from({ length:7  }, (_, i) => history[getDateKey(i+1)]);
  const doneDays  = last7.filter(isComplete).length;
  const totalChecks7 = last7.reduce((s,e) => s+checksCount(e), 0);
  const consistency  = Math.round((doneDays/7)*100);
  const catBars = CHECKS_DEF.map(({ id, label }) => ({ label, total: last7.filter(e=>e?.checks?.[id]).length })).sort((a,b)=>b.total-a.total);
  const done = Object.values(checks).filter(Boolean).length;

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-zinc-600 gap-3">
      <Icons.Loader /> Loading your history…
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Current Streak" value={`${streak}d`} sub={streak===0?"Start today":streak<7?"Building…":streak<14?"One week+ 🔥":"Legendary 🚀"} accent="orange" />
        <StatCard label="7-Day Consistency" value={`${consistency}%`} sub={`${doneDays}/7 days complete`} accent="emerald" />
        <StatCard label="Checks This Week" value={totalChecks7} sub="out of 28 possible" accent="blue" />
        <StatCard label="Total Logged Days" value={Object.keys(history).length} sub="since you started" accent="violet" />
      </div>

      {/* Today snapshot */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs tracking-widest uppercase text-zinc-500 flex items-center gap-2"><Icons.Calendar /> Today</div>
          <button onClick={onGoToLog} className="text-[10px] text-blue-400 hover:text-blue-300 tracking-wider">{submitted?"VIEW LOG →":"COMPLETE NOW →"}</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CHECKS_DEF.map(({ id, label }) => (
            <div key={id} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${checks[id]?"text-emerald-400 bg-emerald-500/10":"text-zinc-600 bg-zinc-800/50"}`}>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${checks[id]?"bg-emerald-400":"bg-zinc-700"}`} />
              {label}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-700" style={{ width:`${(done/4)*100}%` }} />
          </div>
          <span className="text-xs text-zinc-600 font-mono">{done}/4</span>
        </div>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs tracking-widest uppercase text-zinc-500">28-Day Activity</div>
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
            <div className="w-2.5 h-2.5 rounded-sm bg-zinc-800" /> None
            <div className="w-2.5 h-2.5 rounded-sm bg-orange-500/40 ml-1" /> Partial
            <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500 ml-1" /> Full
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {["M","T","W","T","F","S","S"].map((d,i) => <div key={i} className="text-[9px] text-zinc-700 text-center pb-0.5">{d}</div>)}
          {last28.map(({ key, count, label }) => <HeatCell key={key} count={count} label={label} />)}
        </div>
      </div>

      {/* Category bars */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
        <div className="text-xs tracking-widest uppercase text-zinc-500">Category Consistency (7 days)</div>
        <div className="space-y-2.5">
          {catBars.map(({ label, total }) => (
            <div key={label} className="space-y-1">
              <div className="flex justify-between text-xs"><span className="text-zinc-400">{label}</span><span className="text-zinc-600 font-mono">{total}/7</span></div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-700" style={{ width:`${(total/7)*100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Streak bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
        <div className="flex justify-between items-center">
          <div className="text-xs tracking-widest uppercase text-zinc-500 flex items-center gap-2"><Icons.Flame /> Streak Goal: 30 Days</div>
          <span className="text-xs text-zinc-600 font-mono">{streak}/30</span>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-700" style={{ width:`${Math.min((streak/30)*100,100)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-700">
          {[0,7,14,21,30].map(n=><span key={n} className={streak>=n&&n>0?"text-zinc-500":""}>{n}d</span>)}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  PAGE 3 — WEEKLY REVIEW
// ════════════════════════════════════════════════════════════
function WeeklyReviewPage({ history, loading }) {
  const week = Array.from({ length:7 }, (_, i) => {
    const key  = getDateKey(6-i);
    const entry = history[key];
    return { key, label: new Date(key+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"}), count:checksCount(entry), entry };
  });

  const doneDays    = week.filter(d=>d.count===4).length;
  const missedDays  = week.filter(d=>d.count===0).length;
  const partialDays = 7-doneDays-missedDays;
  const consistency = Math.round((doneDays/7)*100);
  const catBreakdown = CHECKS_DEF.map(({ id, label }) => ({ id, label, days: week.filter(d=>d.entry?.checks?.[id]).length }));
  const insights = [];
  if (doneDays>=5)    insights.push({ color:"green",  icon:Icons.TrendingUp,  title:"Strong week",            body:`${doneDays}/7 days fully completed. Keep going.` });
  if (missedDays>=3)  insights.push({ color:"red",    icon:Icons.AlertCircle, title:"Several gaps",           body:`${missedDays} missed days. Find the pattern and pre-plan.` });
  if (partialDays>=3) insights.push({ color:"yellow", icon:Icons.AlertCircle, title:"Partial days detected",  body:`${partialDays} days were incomplete. Finishing the checklist is your unlock.` });
  const weakCat = [...catBreakdown].sort((a,b)=>a.days-b.days)[0];
  if (weakCat?.days<=2) insights.push({ color:"yellow", icon:Icons.AlertCircle, title:`Weak: ${weakCat.label}`, body:`Only ${weakCat.days}/7 days. Fix this first next week.` });
  if (insights.length===0) insights.push({ color:"blue", icon:Icons.Star, title:"Keep logging", body:"Your patterns will surface here as your history builds." });

  const missions = week.filter(d=>d.entry?.log?.mission).map(d=>({ label:d.label, text:d.entry.log.mission }));
  const wins     = week.filter(d=>d.entry?.log?.wins).map(d=>({ label:d.label, text:d.entry.log.wins }));

  const iconColors = { green:"text-emerald-400", yellow:"text-yellow-400", red:"text-red-400", blue:"text-blue-400" };

  if (loading) return <div className="flex items-center justify-center py-24 text-zinc-600 gap-3"><Icons.Loader />Loading…</div>;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center"><div className="text-2xl font-bold text-white font-mono">{doneDays}</div><div className="text-[10px] tracking-widest uppercase text-emerald-500/70 mt-1">Complete</div></div>
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-center"><div className="text-2xl font-bold text-white font-mono">{partialDays}</div><div className="text-[10px] tracking-widest uppercase text-yellow-500/70 mt-1">Partial</div></div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center"><div className="text-2xl font-bold text-white font-mono">{missedDays}</div><div className="text-[10px] tracking-widest uppercase text-red-500/70 mt-1">Missed</div></div>
      </div>

      {/* Consistency score */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-2">
        <div className="flex justify-between items-center">
          <div className="text-xs tracking-widest uppercase text-zinc-500">Weekly Consistency Score</div>
          <span className={`text-2xl font-bold font-mono ${consistency>=70?"text-emerald-400":consistency>=40?"text-yellow-400":"text-red-400"}`}>{consistency}%</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${consistency>=70?"bg-gradient-to-r from-emerald-500 to-teal-400":consistency>=40?"bg-gradient-to-r from-yellow-500 to-amber-400":"bg-gradient-to-r from-red-500 to-orange-400"}`} style={{ width:`${consistency}%` }} />
        </div>
        <div className="text-[10px] text-zinc-600">{consistency>=70?"Excellent. Stay the course.":consistency>=40?"Getting there. Tighten up the gaps.":"Rough week. Reset, don't quit."}</div>
      </div>

      {/* Bar chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
        <div className="text-xs tracking-widest uppercase text-zinc-500">Daily Completion</div>
        <div className="flex items-end gap-2 h-24">
          {week.map(({ key, label, count }) => {
            const pct = (count/4)*100;
            const isToday = key===getTodayKey();
            const color = count===4?"bg-emerald-500":count>=2?"bg-blue-500":count===1?"bg-yellow-500/70":"bg-zinc-800";
            return (
              <div key={key} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col justify-end h-20 relative group">
                  <div className={`w-full rounded-t-md ${color} transition-all duration-700`} style={{ height:`${Math.max(pct, count===0?8:0)}%` }}>
                    {isToday && <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-400" />}
                  </div>
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-zinc-800 border border-zinc-700 text-[10px] px-1.5 py-0.5 rounded text-zinc-300 whitespace-nowrap z-10">{count}/4</div>
                </div>
                <span className={`text-[10px] ${isToday?"text-blue-400":"text-zinc-600"}`}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
        <div className="text-xs tracking-widest uppercase text-zinc-500">Category Breakdown</div>
        <div className="space-y-3">
          {catBreakdown.map(({ id, label, days }) => (
            <div key={id} className="space-y-1">
              <div className="flex justify-between text-xs"><span className="text-zinc-400">{label}</span><span className="text-zinc-600 font-mono">{days}/7</span></div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${days>=5?"bg-emerald-500":days>=3?"bg-blue-500":"bg-red-500/60"}`} style={{ width:`${(days/7)*100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Insights */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-4">
        <div className="text-xs tracking-widest uppercase text-zinc-500">Patterns & Insights</div>
        {insights.map((ins, i) => (
          <div key={i} className="flex gap-3">
            <span className={`mt-0.5 flex-shrink-0 ${iconColors[ins.color]}`}><ins.icon /></span>
            <div><div className="text-sm text-zinc-300 font-medium">{ins.title}</div><div className="text-xs text-zinc-600 mt-0.5">{ins.body}</div></div>
          </div>
        ))}
      </div>

      {missions.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
          <div className="text-xs tracking-widest uppercase text-zinc-500">This Week's Missions</div>
          {missions.map(({ label, text }) => (
            <div key={label} className="flex gap-3 text-sm"><span className="text-zinc-600 w-8 flex-shrink-0">{label}</span><span className="text-zinc-300">{text}</span></div>
          ))}
        </div>
      )}

      {wins.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 space-y-3">
          <div className="text-xs tracking-widest uppercase text-amber-500/70">This Week's Wins</div>
          {wins.map(({ label, text }) => (
            <div key={label} className="flex gap-3 text-sm"><span className="text-zinc-600 w-8 flex-shrink-0">{label}</span><span className="text-zinc-300">{text}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  APP SHELL
// ════════════════════════════════════════════════════════════
export default function App() {
  const [page, setPage] = useState("log");
  const dailyLog = useDailyLog();
  const { history, loading } = useHistory();
  const { checks, submitted, syncStatus } = dailyLog;

  // Merge server history with today's live state so dashboard is always current
  const liveHistory = {
    ...history,
    [getTodayKey()]: {
      checks,
      submitted,
      log: dailyLog.log,
    },
  };

  const streak = useStreakFromAPI(liveHistory);
  const completedChecks = Object.values(checks).filter(Boolean).length;

  const today = new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
  const navItems = [
    { id:"log",       label:"Log",     icon:Icons.Book },
    { id:"dashboard", label:"Overview",icon:Icons.Grid },
    { id:"weekly",    label:"Weekly",  icon:Icons.BarChart },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white" style={{ fontFamily:"'IBM Plex Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@700;800&display=swap');`}</style>

      <header className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
              <Icons.Rocket />
            </div>
            <div>
              <div className="text-sm font-bold tracking-wider" style={{ fontFamily:"'Syne', sans-serif" }}>CAPTAIN'S LOG</div>
              <div className="text-[10px] text-zinc-600 tracking-widest uppercase hidden sm:block">{today}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className={streak>0?"text-orange-400":"text-zinc-700"}><Icons.Flame /></span>
              <span className="text-sm font-bold font-mono">{streak}</span>
              <span className="text-xs text-zinc-600 hidden sm:inline">streak</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full transition-all duration-500"
                  style={{ width:`${(completedChecks/4)*100}%` }} />
              </div>
              <span className="text-[10px] text-zinc-600 font-mono">{completedChecks}/4</span>
            </div>
            {/* Server status dot */}
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${syncStatus==="offline"?"bg-amber-500 animate-pulse":syncStatus==="saving"?"bg-blue-500 animate-pulse":"bg-emerald-500/40"}`}
              title={syncStatus==="offline"?"Offline — saving locally":syncStatus==="saving"?"Syncing…":"Connected"} />
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-5">
          <div className="flex border-t border-zinc-800/60">
            {navItems.map(({ id, label, icon:Icon }) => (
              <button key={id} onClick={() => setPage(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2
                  ${page===id?"border-blue-500 text-blue-400":"border-transparent text-zinc-600 hover:text-zinc-400"}`}>
                <Icon /><span className="uppercase">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8">
        {page==="log"       && <DailyLogPage dailyLog={dailyLog} />}
        {page==="dashboard" && <DashboardPage history={liveHistory} streak={streak} checks={checks} submitted={submitted} loading={loading} onGoToLog={()=>setPage("log")} />}
        {page==="weekly"    && <WeeklyReviewPage history={liveHistory} loading={loading} />}
        <div className="text-center text-zinc-800 text-xs pt-8 pb-4">captain's log · step 5 of 5 · fully connected ✓</div>
      </main>
    </div>
  );
}
