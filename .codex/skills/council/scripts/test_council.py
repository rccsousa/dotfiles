"""Protocol and failure-path regression checks; no model calls or AoE mutations."""

import argparse
import contextlib
import io
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import council


class CouncilTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.run = Path(self.temp.name).resolve()
        self.roles = [
            {"key": "member-1", "provider": "codex", "model": "gpt-6.1-sol", "title": "test-member-1"},
            {"key": "member-2", "provider": "claude", "model": "claude-opus-5-5", "title": "test-member-2"},
            {"key": "moderator", "provider": "claude", "model": "claude-opus-5-5", "title": "test-moderator"},
        ]
        for role in self.roles:
            (self.run / role["key"]).mkdir()
        self.config = {"format": "model-council-v1", "run": str(self.run), "id": "test",
                       "roles": self.roles, "profile": "main", "rounds": 2, "words": 100,
                       "effort": "low", "turn_timeout": 2, "expires_at": time.time() + 60}
        council.atomic(self.run / "config.json", self.config)
        council.atomic(self.run / "brief.md", "Select a storage format.\n")

    def run_protocol(self, ask):
        with patch.object(council, "launch"), patch.object(council, "ask", side_effect=ask), \
             patch.object(council, "stop_sessions", return_value=[]) as stop, \
             contextlib.redirect_stdout(io.StringIO()):
            council.coordinate(argparse.Namespace(run=str(self.run)))
            self.assertEqual(stop.call_count, 1)
        return council.read(self.run / "state.json")

    def test_blind_proposals_full_exchange_and_audits_before_decision(self):
        seen = {}

        def answer(run, config, role, turn, instructions, transcript):
            seen[(role["key"], turn)] = transcript
            return f"\n{role['key']}:{turn}: dissent remains\n"

        state = self.run_protocol(answer)
        self.assertEqual(state["status"], "complete")
        self.assertEqual(len(seen), 12)
        for key in ("member-1", "member-2"):
            self.assertEqual(seen[key, "01-proposal"], "")
            self.assertIn("member-1:01-proposal", seen[key, "03-discuss-1"])
            self.assertIn("member-2:01-proposal", seen[key, "03-discuss-1"])
            self.assertIn("moderator:02-agenda", seen[key, "03-discuss-1"])
            self.assertIn("moderator:06-synthesis-2", seen[key, "90-audit"])
            self.assertIn(key + ":90-audit", seen["moderator", "99-decision"])
        self.assertIn("dissent remains", (self.run / "decision.md").read_text())

    def test_missing_participant_fails_without_a_decision(self):
        def answer(run, config, role, turn, instructions, transcript):
            if role["key"] == "member-2":
                raise RuntimeError("Model unavailable")
            return "An independent proposal"

        state = self.run_protocol(answer)
        self.assertEqual(state["status"], "failed")
        self.assertIn("Model unavailable", state["error"])
        self.assertFalse((self.run / "decision.md").exists())

    def test_failed_audit_prevents_completed_decision(self):
        def answer(run, config, role, turn, instructions, transcript):
            if turn == "90-audit" and role["key"] == "member-2":
                raise TimeoutError("Audit timed out")
            return "Evidence-based contribution"

        state = self.run_protocol(answer)
        self.assertEqual(state["status"], "failed")
        self.assertFalse((self.run / "decision.md").exists())

    def test_cleanup_does_not_touch_unrelated_sessions(self):
        sessions = [
            {"id": "ours", "title": "test-member-1", "path": str(self.run / "member-1")},
            {"id": "same-title", "title": "test-member-1", "path": "/another/project"},
            {"id": "same-path", "title": "another-session", "path": str(self.run / "member-1")},
        ]
        with patch.object(council, "aoe", return_value=json.dumps(sessions)) as call, \
             patch.object(council.time, "sleep"):
            self.assertEqual(council.stop_sessions(self.run, self.config), [])
        stopped = [c.args[-1] for c in call.call_args_list if "stop" in c.args]
        self.assertEqual(stopped, ["ours"])
        self.assertTrue((self.run / "STOP").exists())

    def test_empty_successful_provider_response_is_failure(self):
        role = self.roles[1]
        council.atomic(self.run / role["key"] / "01.prompt.md", "Question")
        cmd = [sys.executable, "-c", 'print(\'{"is_error":false,"result":""}\')']
        with patch.object(council, "provider_command", return_value=cmd):
            with self.assertRaisesRegex(RuntimeError, "Empty model response"):
                council.execute_turn(self.run, self.config, role, {"id": "01"})

    def test_turn_timeout_terminates_child(self):
        role = self.roles[1]
        council.atomic(self.run / role["key"] / "01.prompt.md", "Question")
        self.config["turn_timeout"] = 0.1
        cmd = [sys.executable, "-c", "import time; time.sleep(30)"]
        began = time.monotonic()
        with patch.object(council, "provider_command", return_value=cmd):
            with self.assertRaises(TimeoutError):
                council.execute_turn(self.run, self.config, role, {"id": "01"})
        self.assertLess(time.monotonic() - began, 5)

    def test_coordinator_cannot_replay_a_run(self):
        council.atomic(self.run / "state.json", {"status": "complete"})
        with patch.object(council, "launch") as launch:
            with self.assertRaisesRegex(RuntimeError, "public commands"):
                council.coordinate(argparse.Namespace(run=str(self.run)))
        launch.assert_not_called()

    def test_concurrent_coordinator_is_rejected(self):
        with council.acquire_lock(self.run), patch.object(council, "launch") as launch:
            with self.assertRaisesRegex(RuntimeError, "busy"):
                council.coordinate(argparse.Namespace(run=str(self.run)))
        launch.assert_not_called()

    def add_plans(self):
        self.config["plans"] = {}
        for label, text in (("Codex", "Prefer JSON for portability."), ("Claude", "Prefer SQLite for querying.")):
            content = text.encode()
            snapshot = label.lower() + "-plan.md"
            (self.run / snapshot).write_bytes(content)
            self.config["plans"][label] = {"source": "/original/" + snapshot, "snapshot": snapshot,
                                            "sha256": hashlib.sha256(content).hexdigest()}
        council.atomic(self.run / "config.json", self.config)

    def test_existing_plans_are_cross_critiqued_without_new_proposals(self):
        self.add_plans()
        seen = {}

        def respond(run, config, role, turn, instructions, transcript):
            seen[role["key"], turn] = transcript
            return role["key"] + ":" + turn

        self.assertEqual(self.run_protocol(respond)["status"], "complete")
        self.assertFalse(any(turn == "01-proposal" for _, turn in seen))
        for key in ("member-1", "member-2"):
            first = seen[key, "01-critique"]
            self.assertIn("Prefer JSON", first)
            self.assertIn("Prefer SQLite", first)
            self.assertNotIn(":01-critique", first)
        self.assertIn("member-1:01-critique", seen["moderator", "02-agenda"])

    def test_changed_original_snapshot_is_rejected(self):
        self.add_plans()
        (self.run / "codex-plan.md").write_text("Changed original")
        with self.assertRaisesRegex(RuntimeError, "snapshot changed"):
            council.plan_transcript(self.run, self.config)

    def test_both_plans_required_and_original_bytes_preserved(self):
        original = self.run / "input.md"
        content = b"# Plan\r\nKeep all wording.\r\n"
        original.write_bytes(content)
        args = argparse.Namespace(codex_plan=str(original), claude_plan=None)
        with self.assertRaisesRegex(ValueError, "Supply both"):
            council.prepare_plans(args, self.roles[:2])
        args.claude_plan = str(original)
        plans = council.prepare_plans(args, self.roles[:2])
        self.assertEqual(plans["Codex"]["content"], content)
        self.assertEqual(original.read_bytes(), content)

    def submit(self, question_id, text):
        source = self.run / "user-reply.txt"
        source.write_text(text)
        with patch.object(council, "spawn_coordinator", return_value=123), \
             contextlib.redirect_stdout(io.StringIO()):
            council.answer(argparse.Namespace(run=str(self.run), question_id=question_id, answers=str(source)))

    def test_two_interviews_pause_and_share_actual_answers_before_convergence(self):
        self.add_plans()
        self.config.update(grill=True, grill_rounds=2)
        council.atomic(self.run / "config.json", self.config)
        seen = {}

        def respond(run, config, role, turn, instructions, transcript):
            seen[role["key"], turn] = transcript
            return f"{role['key']}:{turn}: Q1: Must it work offline?"

        state = self.run_protocol(respond)
        self.assertEqual(state["status"], "waiting_user")
        self.assertEqual(state["question_id"], "grill-1")
        self.assertNotIn(("moderator", "02-agenda"), seen)
        self.assertFalse((self.run / "decision.md").exists())
        self.assertTrue(Path(state["questions_file"]).exists())

        # Time while the user is away does not consume the active-time budget.
        config = council.read(self.run / "config.json")
        config["expires_at"] = time.time() - 86400
        council.atomic(self.run / "config.json", config)
        self.submit("grill-1", "Must work offline. Q2 is unknown; do not assume.")
        self.assertGreater(council.read(self.run / "config.json")["expires_at"], time.time())
        state = self.run_protocol(respond)
        self.assertEqual(state["status"], "waiting_user")
        self.assertEqual(state["question_id"], "grill-2")
        for key in ("member-1", "member-2"):
            self.assertIn("Must work offline", seen[key, "03-discuss-1"])
        self.assertNotIn(("moderator", "99-decision"), seen)
        self.submit("grill-2", "Use local storage; defer sync. Codex, explain backup options.")
        state = self.run_protocol(respond)
        self.assertEqual(state["status"], "complete")
        for key in ("member-1", "member-2"):
            self.assertIn("defer sync", seen[key, "90-audit"])
        self.assertIn("Q2 is unknown", seen["moderator", "99-decision"])

    def test_stale_empty_duplicate_and_cancelled_answers_are_rejected(self):
        self.config.update(grill=True, grill_rounds=1)
        council.atomic(self.run / "config.json", self.config)
        self.run_protocol(lambda *args: "Q1: Which constraints matter?")
        with self.assertRaisesRegex(ValueError, "stale"):
            self.submit("grill-2", "Some answer")
        with self.assertRaisesRegex(ValueError, "actual user answer"):
            self.submit("grill-1", "  ")
        self.submit("grill-1", "Portability matters most")
        with self.assertRaisesRegex(ValueError, "stale"):
            self.submit("grill-1", "Duplicate reply")
        state = council.read(self.run / "state.json")
        state.update(status="waiting_user", question_id="grill-2")
        council.atomic(self.run / "state.json", state)
        council.atomic(self.run / "STOP", "Stopped")
        with self.assertRaisesRegex(RuntimeError, "stopped"):
            self.submit("grill-2", "Late answer")

    def test_recorded_replies_are_reused_without_requeuing_model_calls(self):
        original_atomic = council.atomic
        requests = []

        def write(path, value):
            original_atomic(path, value)
            if str(path).endswith(".request.json"):
                requests.append(path)
                folder = Path(path).parent
                output = folder / "01.md"
                output.write_text("Recorded answer")
                original_atomic(folder / "01.result.json", {"id": "01", "status": "complete", "output": str(output)})

        with patch.object(council, "atomic", side_effect=write):
            first = council.ask(self.run, self.config, self.roles[0], "01", "Critique", "")
            second = council.ask(self.run, self.config, self.roles[0], "01", "Critique", "")
            self.assertEqual(first, second)
            self.assertEqual(len(requests), 1)
            with self.assertRaisesRegex(RuntimeError, "Inputs changed"):
                council.ask(self.run, self.config, self.roles[0], "01", "New instruction", "")

    def test_single_interview_finishes_after_one_reply(self):
        self.config.update(grill=True, grill_rounds=1)
        council.atomic(self.run / "config.json", self.config)
        self.assertEqual(self.run_protocol(lambda *args: "Q1: What matters?")["status"], "waiting_user")
        self.submit("grill-1", "Prioritize portability; proceed with remaining unknowns explicit.")
        seen = []

        def respond(run, config, role, turn, instructions, transcript):
            seen.append(turn)
            return "A contribution"

        self.assertEqual(self.run_protocol(respond)["status"], "complete")
        self.assertFalse(any(turn.startswith("grill-2") for turn in seen))

    def test_stopping_a_paused_run_records_cancellation(self):
        council.atomic(self.run / "state.json", {"status": "waiting_user", "question_id": "grill-1"})
        with patch.object(council, "aoe", return_value="[]"), \
             patch.object(council.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            council.stop(argparse.Namespace(run=str(self.run)))
        self.assertEqual(council.read(self.run / "state.json")["status"], "cancelled")
        self.assertTrue((self.run / "STOP").exists())

    def start_from_cli(self, *options):
        stdout = io.StringIO()
        argv = ["council.py", "start", "--brief", str(self.run / "brief.md"),
                "--root", str(self.run / "new-runs"), *options]
        with patch.object(sys, "argv", argv), patch.object(council.shutil, "which", return_value="installed"), \
             patch.object(council, "spawn_coordinator", return_value=123), contextlib.redirect_stdout(stdout):
            self.assertEqual(council.main(), 0)
        return council.read(Path(json.loads(stdout.getvalue())["run"]) / "config.json")

    def test_every_role_defaults_to_medium(self):
        config = self.start_from_cli()
        self.assertEqual([r["effort"] for r in config["roles"]], ["medium"] * 3)

    def test_astra_medium_opus_high_routes_to_provider_commands(self):
        config = self.start_from_cli("--member", "astra@med", "--member", "opus@hi")
        astra, opus, moderator = config["roles"]
        self.assertEqual([r["effort"] for r in config["roles"]], ["medium", "high", "medium"])
        codex_cmd = council.provider_command(astra, config, self.run / "output.md")
        claude_cmd = council.provider_command(opus, config, self.run / "output.md")
        self.assertIn('model_reasoning_effort="medium"', codex_cmd)
        self.assertEqual(claude_cmd[claude_cmd.index("--effort") + 1], "high")
        self.assertEqual(moderator["model"], "gpt-6.1-sol")

    def test_role_overrides_win_over_global_effort(self):
        config = self.start_from_cli("--effort", "hi", "--member", "codex:gpt-6-astra@low",
                                     "--member", "claude:claude-opus-5-5", "--moderator", "opus@med")
        self.assertEqual([r["effort"] for r in config["roles"]], ["low", "high", "medium"])

    def test_invalid_effort_fails_before_starting_models(self):
        with patch.object(sys, "argv", ["council.py", "start", "--member", "opus@typo"]), \
             patch.object(council, "spawn_coordinator") as spawn, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                council.main()
        self.assertEqual(error.exception.code, 2)
        spawn.assert_not_called()

    def test_existing_runs_keep_their_recorded_shared_effort(self):
        cmd = council.provider_command(self.roles[0], self.config, self.run / "output.md")
        self.assertIn('model_reasoning_effort="low"', cmd)


if __name__ == "__main__":
    unittest.main()
