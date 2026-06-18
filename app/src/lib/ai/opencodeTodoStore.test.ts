import { describe, expect, it } from "vitest";
import {
  sortSessionTodos,
  summarizeTodoProgress,
  TODO_PRIORITIES,
  TODO_STATUSES,
} from "./opencodeTodoStore";
import type { OpencodeTodoEntry } from "./backends/workspaceAgentBackend";

/**
 * M5-T1 — TODO panel pure helpers: status-then-priority ordering, progress
 * summarization, and the exported status/priority constant lists.
 */
describe("opencodeTodoStore helpers", () => {
  const entry = (
    content: string,
    status: OpencodeTodoEntry["status"],
    priority: OpencodeTodoEntry["priority"],
  ): OpencodeTodoEntry => ({ content, status, priority });

  describe("sortSessionTodos", () => {
    it("orders in_progress → pending → completed → cancelled", () => {
      const todos: OpencodeTodoEntry[] = [
        entry("c", "completed", "low"),
        entry("p", "pending", "low"),
        entry("x", "cancelled", "low"),
        entry("i", "in_progress", "low"),
      ];
      expect(sortSessionTodos(todos).map((t) => t.content)).toEqual([
        "i",
        "p",
        "c",
        "x",
      ]);
    });

    it("breaks ties by priority (high → medium → low)", () => {
      const todos: OpencodeTodoEntry[] = [
        entry("low", "pending", "low"),
        entry("high", "pending", "high"),
        entry("med", "pending", "medium"),
      ];
      expect(sortSessionTodos(todos).map((t) => t.content)).toEqual([
        "high",
        "med",
        "low",
      ]);
    });

    it("does not mutate the input array", () => {
      const todos: OpencodeTodoEntry[] = [
        entry("b", "pending", "low"),
        entry("a", "pending", "low"),
      ];
      const snapshot = [...todos];
      sortSessionTodos(todos);
      expect(todos.map((t) => t.content)).toEqual(snapshot.map((t) => t.content));
    });
  });

  describe("summarizeTodoProgress", () => {
    it("counts completed vs total and computes the fraction", () => {
      const todos: OpencodeTodoEntry[] = [
        entry("a", "completed", "low"),
        entry("b", "completed", "low"),
        entry("c", "pending", "low"),
        entry("d", "in_progress", "low"),
      ];
      expect(summarizeTodoProgress(todos)).toEqual({
        completed: 2,
        total: 4,
        fraction: 0.5,
      });
    });

    it("returns a 0 fraction for an empty list", () => {
      expect(summarizeTodoProgress([])).toEqual({
        completed: 0,
        total: 0,
        fraction: 0,
      });
    });

    it("does not count cancelled as completed", () => {
      const todos: OpencodeTodoEntry[] = [
        entry("a", "completed", "low"),
        entry("b", "cancelled", "low"),
      ];
      expect(summarizeTodoProgress(todos).completed).toBe(1);
    });
  });

  describe("constant lists", () => {
    it("exposes the four todo statuses", () => {
      expect(TODO_STATUSES).toEqual(["pending", "in_progress", "completed", "cancelled"]);
    });

    it("exposes the three priorities", () => {
      expect(TODO_PRIORITIES).toEqual(["high", "medium", "low"]);
    });
  });
});
