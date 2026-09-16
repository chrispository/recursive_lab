"""Offline validation of a Recursive Lab export; never launches training."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import tomllib


def main():
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / "manifest.json").read_text())
    for name, expected in manifest["files"].items():
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError("Invalid manifest path")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Export file changed: {name}")
    if importlib.metadata.version("verifiers") != "0.3.0":
        raise ValueError("Install verifiers==0.3.0 in the pinned Prime RL environment")
    if importlib.metadata.version("prime-rl") != "0.8.0":
        raise ValueError("Use the Prime RL v0.8.0 checkout recorded in manifest.json")
    from prime_rl.configs.rl import RLConfig
    config = RLConfig.model_validate(tomllib.loads((root / "cluster.toml").read_text()))
    source = config.orchestrator.train.source[0]
    assert source.group_size == 4 and source.legacy.args["split"] == "train"
    import verifiers as vf
    # Do not let the current directory conceal a missing package installation.
    sys.path = [entry for entry in sys.path if Path(entry or ".").resolve() != root]
    env = vf.load_environment(source.legacy.id, **source.legacy.args)
    assert len(env.dataset) == manifest["splits"]["train"] > 0
    print("Verified package, installed environment, and Prime RL training configuration. No training started.")


if __name__ == "__main__":
    main()
