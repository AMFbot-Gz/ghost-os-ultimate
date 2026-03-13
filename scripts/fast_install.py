#!/usr/bin/env python3
"""
fast_install.py — LaRuche Fast-Install Cross-Platform
Compatible macOS, Linux, Windows
"""

import os
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = ROOT / "scripts"

def run(cmd, check=True, **kwargs):
    print(f"  → {cmd}")
    return subprocess.run(cmd, shell=True, check=check, capture_output=False, **kwargs)

def check_command(cmd):
    try:
        subprocess.run(f"which {cmd}", shell=True, check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError:
        return False

def main():
    print("🐝 LaRuche Fast-Install Python v3.0")
    print(f"   OS: {platform.system()} {platform.machine()}")
    print(f"   Root: {ROOT}")
    print()

    # 1. Node.js check
    try:
        result = subprocess.run("node --version", shell=True, capture_output=True, text=True)
        version = result.stdout.strip()
        major = int(version.lstrip("v").split(".")[0])
        if major >= 20:
            print(f"✓ Node.js {version}")
        else:
            print(f"⚠ Node.js {version} — v20+ requis")
    except Exception:
        print("✗ Node.js non trouvé — installer depuis nodejs.org")
        sys.exit(1)

    # 2. Python packages
    print("\n→ Installation packages Python...")
    run(f"{sys.executable} -m pip install -r {ROOT}/requirements.txt -q")
    print("✓ Python packages installés")

    # 3. Node packages
    print("\n→ Installation packages Node.js...")
    os.chdir(ROOT)
    run("npm install")
    print("✓ Node packages installés")

    # 4. .env setup
    env_file = ROOT / ".env"
    env_example = ROOT / ".env.example"
    if not env_file.exists() and env_example.exists():
        import shutil
        shutil.copy(env_example, env_file)
        print("\n✓ .env créé — configurez vos API keys")

    # 5. Ollama check
    if check_command("ollama"):
        print("✓ Ollama disponible")
    else:
        print("⚠ Ollama non trouvé — installer depuis https://ollama.ai")

    print("\n✅ Installation terminée!")
    print("   1. Editez .env avec vos API keys")
    print("   2. Lancez: npm start")
    print("   3. Envoyez /status sur Telegram")

if __name__ == "__main__":
    main()
