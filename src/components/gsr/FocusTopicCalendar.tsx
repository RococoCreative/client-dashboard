// The focus topic calendar, for an admin on Goals > Monthly focus: one theme per month, planned
// for this month and the twelve after it, so the topic is decided before the month's GSR opens.
// Each row saves on blur. A topic saved for a month whose GSR already exists is copied onto that
// GSR when the GSR has no theme of its own, and its description follows while the GSR still carries
// the calendar's theme; a theme an admin typed on the GSR itself is never overwritten. Removing a
// topic clears the calendar row only. The New month dialog reads the same rows to pre-fill.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { deleteFocusTopic, listFocusTopics, upsertFocusTopic } from "../../services/focusTopics.ts";
import { listCycles, updateCycle } from "../../services/gsr.ts";
import { defaultCycleName } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { toDateOnly } from "../../lib/format.ts";
import type { FocusTopic, ReviewCycle } from "../../types/database.ts";

// This month and the next twelve, as first-of-month strings.
const MONTHS_AHEAD = 12;

function calendarMonths(today: Date): string[] {
  return Array.from({ length: MONTHS_AHEAD + 1 }, (_, i) => toDateOnly(new Date(today.getFullYear(), today.getMonth() + i, 1)));
}

const blank = (text: string | null | undefined) => !text || text.trim() === "";

// What the calendar should write onto a month's GSR, or null to leave it alone. A GSR with no
// theme takes the topic whole. A GSR already carrying the topic's theme (copied from here
// earlier) takes the description when it has none, so writing the theme first and the
// description after still lands both. Anything typed on the GSR stays.
function cyclePatch(cycle: ReviewCycle, topic: FocusTopic): { theme: string; theme_description: string | null } | null {
  if (blank(cycle.theme)) return { theme: topic.theme, theme_description: topic.description };
  if (cycle.theme === topic.theme && blank(cycle.theme_description) && !blank(topic.description)) {
    return { theme: topic.theme, theme_description: topic.description };
  }
  return null;
}

// How a month's GSR stands against its calendar row, in one quiet line.
function CycleNote({ cycle, topic }: { cycle: ReviewCycle | undefined; topic: FocusTopic | undefined }) {
  if (!cycle) return null;
  if (blank(cycle.theme)) return <p className="mt-1 text-[12px] text-ink-3">The {cycle.name} GSR is open with no theme yet.</p>;
  if (topic && cycle.theme === topic.theme) return <p className="mt-1 text-[12px] text-ink-3">On the {cycle.name} GSR.</p>;
  return <p className="mt-1 text-[12px] text-ink-3">The {cycle.name} GSR keeps its own theme: {cycle.theme}</p>;
}

export default function FocusTopicCalendar({ companyId }: { companyId: string }) {
  const location = useLocation();
  const [months] = useState(() => calendarMonths(new Date()));
  const [error, setError] = useState("");
  const state = useAsync(async () => {
    const [topics, cycles] = await Promise.all([listFocusTopics(companyId, months[0], months[months.length - 1]), listCycles(companyId)]);
    return { topics, cycles: cycles.filter((c) => c.cadence === "monthly") };
  }, [companyId, months]);

  // The GSR list links here by anchor; the router does not scroll to one on its own.
  const loaded = Boolean(state.data);
  useEffect(() => {
    if (loaded && location.hash === "#focus-topics") document.getElementById("focus-topics")?.scrollIntoView({ block: "start" });
  }, [loaded, location.hash]);

  const topicFor = (month: string) => state.data?.topics.find((t) => t.month === month);
  const cycleFor = (month: string) => state.data?.cycles.find((c) => c.period_start === month);

  // A month's theme and description are one row and each write sends both, so a theme left by a
  // click into the description put two writes in flight, each carrying the other's old half.
  // Writes for one month queue, and each takes the half it does not change from the topic the one
  // before it saved (or from the row as shown when that one failed).
  const monthChains = useRef(new Map<string, Promise<FocusTopic | undefined>>());

  // True when the topic landed, false once the panel shows why not.
  async function save(month: string, change: { theme: string } | { description: string | null }): Promise<boolean> {
    setError("");
    const before = monthChains.current.get(month) ?? Promise.resolve(undefined);
    const shown = topicFor(month);
    const chained = before.then((latest) => {
      const current = latest ?? shown;
      const theme = "theme" in change ? change.theme : (current?.theme ?? "");
      const description = "description" in change ? change.description : (current?.description ?? null);
      return upsertFocusTopic(companyId, month, theme, description);
    });
    monthChains.current.set(month, chained.catch(() => undefined));
    try {
      const topic = await chained;
      state.setData((prev) => (prev ? { ...prev, topics: [...prev.topics.filter((t) => t.month !== month), topic] } : prev));
      const cycle = cycleFor(month);
      const patch = cycle ? cyclePatch(cycle, topic) : null;
      if (cycle && patch) {
        const next = await updateCycle(cycle.id, patch);
        state.setData((prev) => (prev ? { ...prev, cycles: prev.cycles.map((c) => (c.id === next.id ? next : c)) } : prev));
      }
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function remove(topic: FocusTopic) {
    setError("");
    try {
      await deleteFocusTopic(topic.id);
      // A later write for the month starts from nothing, not from the topic just removed.
      monthChains.current.delete(topic.month);
      state.setData((prev) => (prev ? { ...prev, topics: prev.topics.filter((t) => t.id !== topic.id) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div id="focus-topics" className="scroll-mt-6">
      <Section
        eyebrow="The whole company, one topic a month"
        title="Focus topic calendar"
        description="The topic each month's #1 GSR is built on, such as a core value or a process push. When a month's GSR opens, it starts with that month's topic. A GSR already open with no theme picks the topic up when you save it here; a theme typed on the GSR stays as it is."
        padded={false}
      >
        {state.error && !state.data ? <Notice tone="error" className="m-5">{state.error}</Notice> : null}
        {!state.data && !state.error ? <div className="p-5"><SkeletonRows rows={6} /></div> : null}
        {error ? <Notice tone="error" className="mx-5 mt-4">{error}</Notice> : null}
        {state.data ? (
          <ul className="divide-y divide-line">
            {months.map((month, index) => {
              const topic = topicFor(month);
              const label = defaultCycleName("monthly", month);
              return (
                // One grid for both widths: on a phone the month and its Remove button share the
                // first line and the fields stack under them; from md up the four sit in a row.
                <li key={month} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-5 py-3 md:grid-cols-[9.5rem_minmax(0,2fr)_minmax(0,3fr)_2rem] md:items-start">
                  <div className="flex min-h-9 items-center gap-2">
                    <span className={`whitespace-nowrap text-[13px] ${topic ? "text-ink" : "text-ink-3"}`}>{label}</span>
                    {index === 0 ? <Badge tone="accent">Now</Badge> : null}
                  </div>
                  <div className="flex min-h-9 items-center justify-end md:col-start-4 md:row-start-1">
                    {topic ? (
                      <IconButton label={`Remove the ${label} topic`} onClick={() => void remove(topic)}>
                        <Trash2 size={14} aria-hidden />
                      </IconButton>
                    ) : null}
                  </div>
                  <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1">
                    <BlurInput
                      ariaLabel={`Theme for ${label}`}
                      value={topic?.theme ?? ""}
                      placeholder="No topic yet"
                      required
                      onSave={(next) => save(month, { theme: next })}
                      className={`${inputClass} mt-0 text-[13px]`}
                    />
                    <CycleNote cycle={cycleFor(month)} topic={topic} />
                  </div>
                  {/* A month with no topic has no description to write yet, so the cell stays empty
                      and the row reads as one quiet placeholder. */}
                  {topic ? (
                    <div className="col-span-2 md:col-span-1 md:col-start-3 md:row-start-1">
                      <BlurInput
                        ariaLabel={`Description for ${label}`}
                        value={topic.description ?? ""}
                        placeholder="What it asks of people (optional)"
                        onSave={(next) => save(month, { description: next })}
                        className={`${inputClass} mt-0 text-[13px]`}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>
    </div>
  );
}
