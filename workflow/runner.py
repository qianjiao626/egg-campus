"""Local threaded coordinator for the Dandan Campus multi-agent workflow.

This process coordinates state and Git isolation. It never claims an agent
completed product work until a real role run records that result.
"""

from __future__ import annotations

import argparse
import json
import queue
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "workflow" / "runtime"
INBOX = RUNTIME / "inbox"
OUTBOX = RUNTIME / "outbox"
TASKS = RUNTIME / "tasks"
STATE_FILE = RUNTIME / "state.json"
STOP_FILE = RUNTIME / "stop"
ROLES = ("pm", "ba", "dev", "qa", "fixer")


def ensure_runtime() -> None:
    for directory in (INBOX, OUTBOX, TASKS):
        directory.mkdir(parents=True, exist_ok=True)


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {
            "phase": "awaiting_requirement",
            "requirement": None,
            "pmConfirmed": False,
            "tasks": [],
            "updatedAt": time.time(),
        }
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state: dict[str, Any]) -> None:
    state["updatedAt"] = time.time()
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(STATE_FILE)


def write_message(name: str, content: str) -> None:
    (OUTBOX / name).write_text(content, encoding="utf-8")


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, encoding="utf-8").strip()


def assert_main_clean() -> None:
    dirty = git("status", "--porcelain", "main")
    if dirty:
        raise RuntimeError("main is dirty; workflow will not create task branches")


@dataclass
class Event:
    target: str
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)


class Coordinator:
    def __init__(self) -> None:
        self.events: queue.Queue[Event] = queue.Queue()
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.threads: list[threading.Thread] = []

    def start(self) -> None:
        ensure_runtime()
        STOP_FILE.unlink(missing_ok=True)
        for role in ROLES:
            thread = threading.Thread(target=self._role_loop, args=(role,), name=f"dandan-{role}", daemon=True)
            thread.start()
            self.threads.append(thread)
        threading.Thread(target=self._watch_inbox, name="dandan-inbox", daemon=True).start()
        write_message("workflow-status.md", "# Workflow online\n\nPhase: awaiting requirement\n")

    def _watch_inbox(self) -> None:
        handled: set[Path] = set()
        while not self.stop.is_set():
            for file in INBOX.glob("*.json"):
                if file in handled:
                    continue
                try:
                    event = json.loads(file.read_text(encoding="utf-8"))
                    target = "pm" if event["type"] in {"requirement", "confirm"} else event["target"]
                    self.events.put(Event(target, event["type"], event))
                    handled.add(file)
                except (KeyError, json.JSONDecodeError) as error:
                    write_message("workflow-error.md", f"Invalid inbox message {file.name}: {error}\n")
                    handled.add(file)
            if STOP_FILE.exists():
                self.stop.set()
            time.sleep(0.25)

    def _role_loop(self, role: str) -> None:
        while not self.stop.is_set():
            try:
                event = self.events.get(timeout=0.25)
            except queue.Empty:
                continue
            if event.target != role:
                self.events.put(event)
                time.sleep(0.02)
                continue
            if role == "pm":
                self._pm(event)
            else:
                write_message(f"{role}-waiting.md", f"{role.upper()} waiting for PM-dispatched task.\n")

    def _pm(self, event: Event) -> None:
        with self.lock:
            state = load_state()
            if event.kind == "requirement":
                requirement = str(event.payload.get("requirement", "")).strip()
                if not requirement:
                    write_message("pm-error.md", "PM rejected empty requirement.\n")
                    return
                state.update({"phase": "awaiting_pm_confirmation", "requirement": requirement, "pmConfirmed": False})
                save_state(state)
                write_message(
                    "pm-requirement.md",
                    "# PM Requirement Intake\n\n"
                    f"## User requirement\n{requirement}\n\n"
                    "## Status\nWaiting for user confirmation before BA task decomposition and branch creation.\n",
                )
                return
            if event.kind == "confirm":
                if state["phase"] != "awaiting_pm_confirmation":
                    write_message("pm-error.md", "PM cannot confirm before a requirement is recorded.\n")
                    return
                assert_main_clean()
                state.update({"phase": "ready_for_ba", "pmConfirmed": True})
                save_state(state)
                write_message("pm-confirmed.md", "# PM confirmation\n\nConfirmed. BA may now build the task tree.\n")
                self.events.put(Event("ba", "decompose", {"requirement": state["requirement"]}))

    def wait(self) -> None:
        while not self.stop.is_set():
            time.sleep(0.5)


def enqueue(event: dict[str, Any]) -> None:
    ensure_runtime()
    stamp = f"{time.time_ns()}-{event['type']}.json"
    (INBOX / stamp).write_text(json.dumps(event, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("start")
    subcommands.add_parser("stop")
    subcommands.add_parser("status")
    submit = subcommands.add_parser("submit")
    submit.add_argument("--requirement", required=True)
    subcommands.add_parser("confirm")
    args = parser.parse_args()

    if args.command == "start":
        coordinator = Coordinator()
        coordinator.start()
        coordinator.wait()
        return 0
    if args.command == "stop":
        ensure_runtime()
        STOP_FILE.touch()
        return 0
    if args.command == "status":
        ensure_runtime()
        print(json.dumps(load_state(), ensure_ascii=False, indent=2))
        return 0
    if args.command == "submit":
        enqueue({"type": "requirement", "requirement": args.requirement})
        return 0
    if args.command == "confirm":
        enqueue({"type": "confirm"})
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
