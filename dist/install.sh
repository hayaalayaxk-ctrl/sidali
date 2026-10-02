#!/bin/sh
# SidAli installer — https://github.com/hayaalayaxk-ctrl/sidali
# Usage: curl -fsSL <install.sh URL> | sh
# Override the source with SIDALI_BASE (e.g. a mirror) or SIDALI_PREFIX (install dir).
set -eu

REPO="hayaalayaxk-ctrl/sidali"
BRANCH="master"
BASE="${SIDALI_BASE:-https://raw.githubusercontent.com/${REPO}/${BRANCH}}"
PREFIX="${SIDALI_PREFIX:-$HOME/.sidali}"
BIN="$PREFIX/bin"

echo "SidAli installer"
echo "  source: $BASE"
echo "  prefix: $PREFIX"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (>=18). Install Node.js first." >&2
  exit 1
fi

mkdir -p "$BIN" "$PREFIX/lib"

for f in sidac engine.node.mjs native.node.mjs sidac.wasm; do
  echo "  fetching $f"
  curl -fsSL "$BASE/dist/$f" -o "$PREFIX/lib/$f"
done
chmod +x "$PREFIX/lib/sidac"

# Expose the CLI on PATH: a tiny wrapper that pins the engine bundle locations.
cat > "$BIN/sidac" <<WRAP
#!/bin/sh
SIDALI_ENGINE="$PREFIX/lib/engine.node.mjs" \
SIDALI_NATIVE="$PREFIX/lib/native.node.mjs" \
exec node "$PREFIX/lib/sidac" "\$@"
WRAP
chmod +x "$BIN/sidac"

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "  note: add $BIN to PATH:  export PATH=\"$BIN:\$PATH\"" ;;
esac

echo "installed: $(command -v sidac 2>/dev/null || echo "$BIN/sidac")"
"$BIN/sidac" version
