import { invoke } from "@tauri-apps/api/core";
import type { Priority, Task } from "./types";
import { addDays, fmtKey, startOfDay } from "./dates";

export const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function taskColor(p: Priority): string {
  return p === "H" ? "#ed8796" : p === "M" ? "#eed49f" : p === "L" ? "#a6da95" : "#7a8aa0";
}
export const ballRank = (p: Priority): number => (p === "H" ? 3 : p === "M" ? 2 : p === "L" ? 1 : 0);

/** Taskwarrior stamp like 20260728T200000Z (UTC) -> local Date. */
function parseDue(s: unknown): Date | null {
  if (typeof s !== "string" || s.length < 15) return null;
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13)));
}

interface RawTask {
  uuid?: string;
  description?: string;
  due?: string;
  priority?: string;
}

export async function loadTasks(): Promise<Task[]> {
  if (!inTauri()) return demoTasks();
  try {
    const raw = JSON.parse(await invoke<string>("tasks_pending")) as RawTask[];
    return raw.map((t) => ({
      id: t.uuid ?? "",
      title: t.description ?? "",
      due: parseDue(t.due),
      priority: (t.priority === "H" || t.priority === "M" || t.priority === "L" ? t.priority : "") as Priority,
    }));
  } catch {
    return [];
  }
}

function demoTasks(): Task[] {
  const t = startOfDay(new Date());
  const at = (n: number, h = 0, m = 0) => {
    const d = addDays(t, n);
    d.setHours(h, m);
    return d;
  };
  return [
    { id: "t1", title: "Submit lab report", due: at(1), priority: "H" },
    { id: "t2", title: "Buy groceries", due: at(1), priority: "M" },
    { id: "t3", title: "Email advisor", due: at(1), priority: "" },
    { id: "t4", title: "Call mom", due: at(2, 17, 30), priority: "L" },
    { id: "t5", title: "Renew library books", due: at(-1), priority: "M" },
    { id: "t6", title: "Read chapter 4", due: at(5), priority: "L" },
  ];
}

export const dayKey = (d: Date): string => fmtKey(d);

/** dayKey -> tasks due that day. */
export function tasksByDay(tasks: Task[]): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due) continue;
    const k = dayKey(t.due);
    (m.get(k) ?? m.set(k, []).get(k)!).push(t);
  }
  return m;
}

export interface Ball {
  rank: number;
  color: string;
  overdue: boolean;
}

/** Distinct priority balls for a day, high -> low; `overdue` marks a rank with past-due pending tasks. */
export function dayBalls(tasks: Task[] | undefined, now = new Date()): Ball[] {
  const balls: Ball[] = [];
  for (const t of tasks ?? []) {
    const rank = ballRank(t.priority);
    const od = !!t.due && now > t.due;
    const existing = balls.find((b) => b.rank === rank);
    if (!existing) balls.push({ rank, color: taskColor(t.priority), overdue: od });
    else if (od) existing.overdue = true;
  }
  return balls.sort((a, b) => b.rank - a.rank);
}
