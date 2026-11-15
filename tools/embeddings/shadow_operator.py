"""Preparation only. Exact Main/owner approval is required before execution.

Attests the CURRENT development worker and an independently approved DB URI
fingerprint before passing credentials in memory/stdin to a frozen bundle.
AWS returns its full configuration to the CLI; --query narrows CLI stdout.
No claim of service-level field permissions, ZDR or a hard USD cap is made.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import urlparse

ACCOUNT = "182498323408"
FUNCTION = "waka-development-BackgroundWorkerFunction-xxbrbmcx"
ARN = f"arn:aws:lambda:us-west-2:{ACCOUNT}:function:{FUNCTION}"


class Refusal(Exception):
    def __init__(self, phase, code):
        self.phase, self.code = phase, code


def digest(value):
    return hashlib.sha256(value).hexdigest()


def aws(phase, args):
    result = subprocess.run(
        ["aws", *args], capture_output=True, text=True, timeout=20,
        env={**os.environ, "AWS_MAX_ATTEMPTS": "1"},
    )
    if result.returncode:
        known = ["AccessDeniedException", "AccessDenied", "ExpiredToken",
                 "ResourceNotFoundException", "ThrottlingException"]
        code = next((v for v in known if re.search(r"\b" + v + r"\b", result.stderr)), "aws_read_failed")
        raise Refusal(phase, code)
    try:
        return json.loads(result.stdout)
    except Exception:
        raise Refusal(phase, "invalid_json")


def main():
    parser = argparse.ArgumentParser(description="Prepared dev-only embedding shadow operator")
    parser.add_argument("--execute-reviewed", action="store_true")
    for name in ["bundle", "manifest", "mode", "invocation", "approved-bundle-sha",
                 "approved-manifest-sha", "approved-operator-sha"]:
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    if not args.execute_reviewed:
        raise Refusal("approval", "explicit_execution_required")
    for value in [args.approved_bundle_sha, args.approved_manifest_sha, args.approved_operator_sha]:
        if not re.fullmatch(r"[a-f0-9]{64}", value):
            raise Refusal("approval", "hash_required")
    if digest(Path(__file__).read_bytes()) != args.approved_operator_sha:
        raise Refusal("operator", "source_guard")
    bundle, manifest_path = Path(args.bundle), Path(args.manifest)
    if digest(bundle.read_bytes()) != args.approved_bundle_sha:
        raise Refusal("bundle", "source_guard")
    if stat.S_IMODE(manifest_path.stat().st_mode) != 0o600:
        raise Refusal("manifest", "private_file_required")
    raw_manifest = manifest_path.read_bytes().rstrip(b"\n")
    if len(raw_manifest) > 65536 or digest(raw_manifest) != args.approved_manifest_sha:
        raise Refusal("manifest", "source_guard")
    manifest = json.loads(raw_manifest)
    try:
        if datetime.fromisoformat(manifest["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
            raise Refusal("manifest", "approval_expired")
    except Refusal:
        raise
    except Exception:
        raise Refusal("manifest", "expiry_required")
    # The supplied file must use the canonical schema order/JSON serialization
    # emitted by the reviewed preparation command; the bundle verifies it too.
    if json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode() != raw_manifest:
        raise Refusal("manifest", "canonical_json_required")
    if args.mode not in ["D0", "D1_prepare", "D1", "R1_signal"] or not re.fullmatch(r"[a-f0-9-]{36}", args.invocation):
        raise Refusal("input", "operation_guard")
    marker = Path(f"/tmp/waka-embedding-shadow-{args.approved_manifest_sha}-{args.invocation}.once")
    if marker.exists():
        raise Refusal("once", "already_attempted")
    if os.environ.get("AWS_REGION") != "us-west-2" or os.environ.get("AWS_DEFAULT_REGION") != "us-west-2":
        raise Refusal("region", "native_region_guard")
    node = subprocess.check_output(["node", "--version"], text=True, timeout=5).strip()
    if not re.fullmatch(r"v20\.\d+\.\d+", node):
        raise Refusal("node", "version_guard")
    identity = aws("account", ["sts", "get-caller-identity", "--query", "{account:Account}", "--output", "json"])
    if identity.get("account") != ACCOUNT:
        raise Refusal("account", "identity_guard")
    projection = "{arn:FunctionArn,app:Environment.Variables.SST_RESOURCE_App,stage:Environment.Variables.WAKA_STAGE,db:Environment.Variables.DB_CONNECTION_URL"
    if args.mode == "D1":
        projection += ",router:Environment.Variables.OPENROUTER_API_KEY,collection:Environment.Variables.WAKA_OPENROUTER_DATA_COLLECTION,zdr:Environment.Variables.WAKA_OPENROUTER_REQUIRE_ZDR"
    projection += "}"
    metadata = aws("runtime", ["lambda", "get-function-configuration", "--region", "us-west-2", "--function-name", FUNCTION, "--query", projection, "--output", "json"])
    if metadata.get("arn") != ARN or metadata.get("stage") != "development":
        raise Refusal("runtime", "identity_guard")
    app = json.loads(metadata.get("app", ""))
    if app.get("name") != "waka" or app.get("stage") != "development":
        raise Refusal("app", "identity_guard")
    uri = metadata.get("db")
    if not isinstance(uri, str) or digest(uri.encode()) != manifest.get("approvedDbSha256"):
        raise Refusal("database", "independent_fingerprint_guard")
    parsed = urlparse(uri)
    if parsed.scheme not in ["postgres", "postgresql"] or not parsed.hostname or not parsed.hostname.endswith(".neon.tech") or "us-east-1" not in parsed.hostname or "-pooler" not in parsed.hostname:
        raise Refusal("database", "development_topology_guard")
    privacy = {"dataCollection": metadata.get("collection") or None, "requireZdr": metadata.get("zdr") or None}
    if privacy["dataCollection"] not in [None, "deny"] or privacy["requireZdr"] not in [None, "0", "1"]:
        raise Refusal("privacy", "configuration_guard")
    payload = {"mode": args.mode, "invocationId": args.invocation, "manifest": manifest,
               "manifestSha256": args.approved_manifest_sha, "dbUrl": uri, "privacy": privacy,
               "attestation": {"accountId": ACCOUNT, "stage": "development", "workerArn": ARN,
                               "appName": "waka", "appStage": "development"}}
    if args.mode == "D1":
        if not isinstance(metadata.get("router"), str) or len(metadata["router"]) < 8:
            raise Refusal("credential", "missing_runtime_credential")
        payload["apiKey"] = metadata["router"]
    env = {k: v for k, v in os.environ.items() if k in ["PATH", "LANG", "LC_ALL", "TZ"]}
    result = subprocess.run(["node", str(bundle), "--execute", "--approved-sha", args.approved_bundle_sha], input=json.dumps(payload), capture_output=True, text=True, env=env, timeout=75)
    metadata.clear(); payload.clear(); uri = None
    if len(result.stdout.encode()) > 65536:
        raise Refusal("runner", "receipt_size")
    receipt = json.loads(result.stdout)
    if not isinstance(receipt, dict) or not isinstance(receipt.get("passed"), bool):
        raise Refusal("runner", "invalid_receipt")
    wake = {"attempted": False, "accepted": False}
    if args.mode == "R1_signal" and result.returncode == 0 and receipt["passed"]:
        recovery = receipt.get("receipt")
        if not isinstance(recovery, dict) or type(recovery.get("renewedCells")) is not int or recovery["renewedCells"] not in [0, 1]:
            raise Refusal("runner", "invalid_recovery_receipt")
        if recovery["renewedCells"] == 1:
            # The child has committed metadata and terminated. Never import
            # the local app queue or dispatch a model inside the operator.
            # One asynchronous wake uses only this freshly attested worker.
            wake["attempted"] = True
            try:
                response = aws("wake", ["lambda", "invoke", "--region", "us-west-2",
                    "--function-name", ARN, "--invocation-type", "Event",
                    "--payload", '{"mode":"enqueue"}', "--cli-binary-format", "raw-in-base64-out",
                    "--query", "{status:StatusCode}", "--output", "json", "/dev/null"])
                wake["accepted"] = response.get("status") == 202
            except (Refusal, subprocess.TimeoutExpired):
                # Metadata is confirmed; an uncertain wake is not rollback
                # and does not authorize replaying either mutation or HTTP.
                wake["accepted"] = False
    print(json.dumps({"operatorIdentityVerified": True, "mode": args.mode,
                      "bundleSha256": args.approved_bundle_sha, "childExit": result.returncode,
                      "stderrPresent": bool(result.stderr), "receipt": receipt,
                      "workerWake": wake, "automaticRetryAuthorized": False}))
    if wake["attempted"] and not wake["accepted"]:
        return 1
    return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refusal as error:
        print(json.dumps({"passed": False, "phase": error.phase, "code": error.code, "retryAuthorized": False})); sys.exit(1)
    except subprocess.TimeoutExpired:
        print(json.dumps({"passed": False, "phase": "operator", "code": "deadline", "writeOrDispatchOutcomeMayBeUnknown": True, "retryAuthorized": False})); sys.exit(1)
    except Exception:
        print(json.dumps({"passed": False, "phase": "operator", "code": "operator_refused", "retryAuthorized": False})); sys.exit(1)
