"""Hermetic operator contract tests. All subprocess/AWS seams are fake."""
import contextlib
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

source = Path(__file__).with_name("shadow_operator.py")
spec = importlib.util.spec_from_file_location("embedding_shadow_operator", source)
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


class OperatorContract(unittest.TestCase):
    def run_case(self, mode="D0", changed=None, renewed=1, wake_ok=True):
        with tempfile.TemporaryDirectory(prefix="waka-embedding-operator-fake-") as folder:
            folder = Path(folder)
            bundle = folder / "bundle.mjs"; bundle.write_text("// fixed fake bundle")
            uri = "postgres" + "://synthetic:synthetic@ep-dev-pooler.us-east-1.aws.neon.tech/waka?sslmode=require"
            manifest = {"version": "embedding2-shadow-v1", "approvedDbSha256": operator.digest(uri.encode()), "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
            path = folder / "manifest.json"
            raw = json.dumps(manifest, separators=(",", ":")).encode(); path.write_bytes(raw); path.chmod(0o600)
            args = [str(source), "--execute-reviewed", "--bundle", str(bundle), "--manifest", str(path), "--mode", mode,
                    "--invocation", str(uuid.uuid4()), "--approved-bundle-sha", operator.digest(bundle.read_bytes()),
                    "--approved-manifest-sha", operator.digest(raw), "--approved-operator-sha", operator.digest(source.read_bytes())]
            child_inputs = []; wake_calls = []

            def run(command, **kwargs):
                if command[:2] == ["aws", "sts"]:
                    return type("Result", (), {"returncode": 0, "stdout": json.dumps({"account": operator.ACCOUNT}), "stderr": ""})()
                if command[:3] == ["aws", "lambda", "invoke"]:
                    self.assertEqual(mode, "R1_signal"); self.assertEqual(len(child_inputs), 1)
                    self.assertEqual(command[command.index("--function-name") + 1], operator.ARN)
                    self.assertEqual(command[command.index("--invocation-type") + 1], "Event")
                    self.assertEqual(command[command.index("--payload") + 1], '{"mode":"enqueue"}')
                    self.assertEqual(command[-1], "/dev/null"); wake_calls.append(command)
                    return type("Result", (), {"returncode": 0 if wake_ok else 1, "stdout": json.dumps({"status": 202}), "stderr": ""})()
                if command[:3] == ["aws", "lambda", "get-function-configuration"]:
                    query = command[command.index("--query") + 1]
                    self.assertIn("DB_CONNECTION_URL", query)
                    self.assertEqual("OPENROUTER_API_KEY" in query, mode == "D1")
                    self.assertNotIn("GEMINI_API_KEY", query)
                    metadata = {"arn": operator.ARN, "app": json.dumps({"name": "waka", "stage": "development"}), "stage": "development", "db": uri}
                    if mode == "D1": metadata["router"] = "SYNTHETIC_ROUTER_DO_NOT_PRINT"
                    metadata.update(changed or {})
                    return type("Result", (), {"returncode": 0, "stdout": json.dumps(metadata), "stderr": ""})()
                self.assertEqual(command[0], "node")
                self.assertNotIn("DB_CONNECTION_URL", kwargs["env"])
                self.assertNotIn("OPENROUTER_API_KEY", kwargs["env"])
                body = json.loads(kwargs["input"]); child_inputs.append(body)
                self.assertEqual("apiKey" in body, mode == "D1")
                return type("Result", (), {"returncode": 0, "stdout": json.dumps({"passed": True, "receipt": {"providerCalls": 0, "renewedCells": renewed}}), "stderr": "PRIVATE_FAKE_BODY"})()

            output = io.StringIO()
            with patch.object(operator.sys, "argv", args), patch.object(operator.subprocess, "run", side_effect=run), patch.object(operator.subprocess, "check_output", return_value="v20.20.2\n"), patch.dict(os.environ, {"AWS_REGION": "us-west-2", "AWS_DEFAULT_REGION": "us-west-2"}, clear=True), contextlib.redirect_stdout(output):
                if changed:
                    with self.assertRaises(operator.Refusal): operator.main()
                    self.assertEqual(child_inputs, [])
                else:
                    self.assertEqual(operator.main(), 0 if wake_ok else 1)
                    self.assertEqual(len(child_inputs), 1)
                    self.assertEqual(len(wake_calls), 1 if mode == "R1_signal" and renewed == 1 else 0)
            self.assertNotIn(uri, output.getvalue()); self.assertNotIn("SYNTHETIC_ROUTER", output.getvalue()); self.assertNotIn("PRIVATE_FAKE_BODY", output.getvalue())

    def test_d0_does_not_request_or_forward_provider_key(self): self.run_case()
    def test_metadata_prepare_does_not_request_provider_key(self): self.run_case("D1_prepare")
    def test_signal_metadata_recovery_does_not_request_provider_key(self): self.run_case("R1_signal")
    def test_signal_no_renewal_does_not_invoke_worker(self): self.run_case("R1_signal", renewed=0)
    def test_signal_wake_failure_never_replays_confirmed_metadata(self): self.run_case("R1_signal", wake_ok=False)
    def test_paid_mode_only_forwards_attested_same_stage_key_in_stdin(self): self.run_case("D1")
    def test_different_database_is_rejected_before_child(self): self.run_case(changed={"db": "postgres" + "://synthetic:synthetic@ep-other-pooler.us-east-1.aws.neon.tech/waka"})
    def test_production_or_foreign_runtime_is_rejected_before_child(self):
        self.run_case(changed={"stage": "production"})
        self.run_case(changed={"arn": operator.ARN + "-foreign"})


if __name__ == "__main__": unittest.main()
