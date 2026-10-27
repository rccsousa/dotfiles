import unittest

from angular_review import assess, classify, parse_numstat, pick_roster, pick_tier

SAMPLE_PR = """32\t9\tapps/api/openapi.pin.json
69\t0\tapps/api/src/compliance/wallet-allowlist.spec.ts
32\t0\tapps/api/src/compliance/wallet-allowlist.ts
164\t67\tapps/api/src/compliance/compliance.service.ts
36\t15\tapps/api/src/payments/internal/payment-checks.ts
11\t8\tapps/api/src/payments/payments.dto.ts
40\t0\tapps/api/test/integration/fakes/__fixtures__/screening-response-allowlisted.json
8\t0\tapps/api/test/integration/fakes/screening-fixtures.ts
96\t0\tdocs/adr/0007-allowlist-screened-wallets.md
6\t0\tpackages/types/src/payments/payment-enums.schemas.ts
"""


class ClassifyTest(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(classify("apps/api/openapi.pin.json"), "noise")
        self.assertEqual(classify("bun.lock"), "noise")
        self.assertEqual(classify("a/__fixtures__/x.json"), "noise")
        self.assertEqual(classify("apps/api/test/integration/fakes/screening-fixtures.ts"), "test")
        self.assertEqual(classify("src/x.spec.ts"), "test")
        self.assertEqual(classify("docs/adr/0007.md"), "docs")
        self.assertEqual(classify("apps/api/src/compliance/compliance.service.ts"), "src")

    def test_numstat_binary_and_rename(self):
        files = parse_numstat("-\t-\timg.png\n3\t1\tsrc/{old => new}.ts\n1\t0\tsrc/{ => sub}/x.ts\n2\t0\ta.ts => b.ts\n")
        self.assertEqual(files[0]["added"], 0)
        self.assertEqual([f["path"] for f in files[1:]], ["src/new.ts", "src/sub/x.ts", "b.ts"])


class AssessTest(unittest.TestCase):
    def test_sample_pr_escalates(self):
        result = assess(parse_numstat(SAMPLE_PR), "const allowed = matches(address)")
        self.assertTrue(result["escalate"])
        self.assertIn("money/compliance/auth/crypto", result["signals"])
        self.assertIn("public API/enum contract", result["signals"])
        self.assertNotIn("concurrency/transactions/idempotency", result["signals"])

    def test_single_signal_does_not_escalate(self):
        result = assess(parse_numstat("4\t2\tapps/api/src/payments/fee.ts\n"), "return fee")
        self.assertEqual(result["score"], 1)
        self.assertFalse(result["escalate"])

    def test_text_signal_needs_word_boundary(self):
        result = assess(parse_numstat("1\t1\tsrc/ui/button.tsx\n"), "block trace unlocked")
        self.assertEqual(result["signals"], {})
        result = assess(parse_numstat("1\t1\tsrc/ui/button.tsx\n"), "await db.transaction(")
        self.assertIn("concurrency/transactions/idempotency", result["signals"])

    def test_size_signal(self):
        result = assess(parse_numstat("900\t0\tsrc/ui/big.tsx\n"), "")
        self.assertIn("size", result["signals"])


class RosterTest(unittest.TestCase):
    calm = {"escalate": False, "score": 0, "signals": {}}
    hot = {"escalate": True, "score": 2, "signals": {"a": [], "b": []}}

    def models(self, roster):
        return [(r["role"], r["model"], r["effort"]) for r in roster["roles"]]

    def test_host_defaults(self):
        self.assertEqual(self.models(pick_roster("claude", self.calm)), [
            ("moderator", "opus", "medium"), ("reviewer-1", "sol", "medium"), ("reviewer-2", "opus", "medium")])
        self.assertEqual(pick_roster("codex", self.calm)["roles"][0]["model"], "sol")

    def test_escalation_keeps_host_moderator(self):
        roster = pick_roster("codex", self.hot)
        self.assertEqual(self.models(roster), [
            ("moderator", "sol", "medium"), ("reviewer-1", "opus", "high"), ("reviewer-2", "astra", "medium")])

    def test_no_escalate_and_explicit_members(self):
        self.assertEqual(pick_roster("claude", self.hot, no_escalate=True)["roles"][1]["model"], "sol")
        roster = pick_roster("claude", self.calm, members=["opus@high", "astra"])
        self.assertEqual(self.models(roster)[1:], [("reviewer-1", "opus", "high"), ("reviewer-2", "astra", "medium")])

    def test_effort_overrides(self):
        roster = pick_roster("claude", self.calm, overrides=["opus@hi", "sol@low"])
        self.assertEqual(self.models(roster), [
            ("moderator", "opus", "high"), ("reviewer-1", "sol", "low"), ("reviewer-2", "opus", "high")])
        roster = pick_roster("claude", self.calm, moderator="opus@low", overrides=["opus@high"])
        self.assertEqual(self.models(roster)[0], ("moderator", "opus", "low"))


class TierTest(unittest.TestCase):
    def tier(self, numstat, text=""):
        return pick_tier(assess(parse_numstat(numstat), text))

    def test_docs_only_is_light(self):
        decision = self.tier("120\t30\tapps/web/docs/pages/payments.mdx\n")
        self.assertEqual(decision["tier"], "light")
        self.assertEqual(decision["passes"]["claude"], {"model": "opus", "id": "claude-opus-5-5", "effort": "high"})
        self.assertEqual(decision["passes"]["codex"], {"model": "terra", "id": "gpt-5.6-terra", "effort": "high"})

    def test_single_signal_is_standard(self):
        self.assertEqual(self.tier("4\t2\tapps/api/src/payments/fee.ts\n")["tier"], "standard")

    def test_large_calm_src_is_standard(self):
        self.assertEqual(self.tier("70\t0\tsrc/ui/table.tsx\n")["tier"], "standard")

    def test_escalation_is_heavy(self):
        decision = pick_tier(assess(parse_numstat(SAMPLE_PR), ""))
        self.assertEqual(decision["tier"], "heavy")
        self.assertEqual(decision["passes"]["codex"]["id"], "gpt-6.1-sol")

    def test_forced_tier(self):
        self.assertEqual(pick_tier(assess(parse_numstat(SAMPLE_PR), ""), "light")["tier"], "light")


if __name__ == "__main__":
    unittest.main()
