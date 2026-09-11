import sys, time
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# The live dialogue log lives next to this script (inside the strata folder).
path = Path(__file__).resolve().parent / "strata-live-session.md"
last_size = path.stat().st_size if path.exists() else 0

print(">>> [Strata <-> Antigravity Live Stream Bridge Active]", flush=True)
print(">>> Listening for dialogue in Strata Studio...", flush=True)

while True:
    time.sleep(0.5)
    if path.exists():
        current_size = path.stat().st_size
        if current_size > last_size:
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                f.seek(last_size)
                new_text = f.read()
                last_size = current_size
                if new_text.strip():
                    print(new_text, flush=True)
