#!/bin/sh
# SidAli — install from a source checkout.
#
#   ./install.sh              install the `sidac` / `sidali` launchers into ~/.sidali
#   SIDALI_PREFIX=/opt/sidali ./install.sh
#   ./install.sh --with-dist  also build the dist/ release bundles first
#
# Requires Node >= 18. For a one-line install without a checkout, use
# dist/install.sh instead (it fetches the prebuilt release).
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PREFIX="${SIDALI_PREFIX:-$HOME/.sidali}"
BIN="$PREFIX/bin"

echo "SidAli installer (source checkout)"
echo "  source: $REPO_DIR"
echo "  prefix: $PREFIX"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (>=18). Install Node.js first." >&2
  exit 1
fi

if [ "${1:-}" = "--with-dist" ]; then
  echo "  building dist/ bundles"
  ( cd "$REPO_DIR" && npm install --no-audit --no-fund >/dev/null && npm run build:dist >/dev/null )
fi

mkdir -p "$BIN"

make_launcher() {
  target="$1"; script="$2"; shift 2
  cat > "$BIN/$target" <<WRAP
#!/bin/sh
$*
exec node "$REPO_DIR/$script" "\$@"
WRAP
  chmod +x "$BIN/$target"
  echo "  wrote $BIN/$target"
}

cd "$REPO_DIR"
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null
npm run build >/dev/null

make_launcher sidac bin/sidac.mjs ""
make_launcher sidali bin/sidali.mjs ""

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "  note: add $BIN to PATH:  export PATH=\"$BIN:\$PATH\"" ;;
esac

echo "installed: sidac, sidali -> $BIN"
"$BIN/sidac" version
