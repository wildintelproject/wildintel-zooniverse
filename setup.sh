#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✔  $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠  $*${NC}"; }
err()  { echo -e "${RED}  ✘  $*${NC}" >&2; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(dirname "$ROOT_DIR")/wildintel-trapper-sdk"
SDK_REPO="https://github.com/wildintelproject/wildintelproject-trapper-sdk"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}==> WildINTEL Zooniverse — setup${NC}"
echo ""

# ── git ───────────────────────────────────────────────────────────────────────

if command -v git &>/dev/null; then
    ok "git $(git --version | awk '{print $3}')"
else
    err "git no encontrado. Instálalo desde https://git-scm.com/downloads"
    exit 1
fi

# ── uv ────────────────────────────────────────────────────────────────────────

if command -v uv &>/dev/null; then
    ok "uv $(uv --version)"
else
    warn "uv no encontrado. Instalando..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    if command -v uv &>/dev/null; then
        ok "uv $(uv --version) instalado correctamente."
        warn "Reinicia el terminal (o ejecuta: source ~/.bashrc) para que uv esté disponible en nuevas sesiones."
    else
        err "No se pudo instalar uv. Visita https://docs.astral.sh/uv/getting-started/installation/"
        exit 1
    fi
fi

# ── Trapper SDK (clon hermano, ver [tool.uv.sources] en pyproject.toml) ───────

echo ""
if [[ -f "$SDK_DIR/pyproject.toml" ]]; then
    ok "wildintel-trapper-sdk en $SDK_DIR"
else
    warn "wildintel-trapper-sdk no encontrado en $SDK_DIR. Clonando..."
    if git clone --branch development "$SDK_REPO" "$SDK_DIR"; then
        ok "wildintel-trapper-sdk clonado en $SDK_DIR."
    else
        err "No se pudo clonar $SDK_REPO."
        warn "Clónalo a mano junto a este proyecto: git clone $SDK_REPO $SDK_DIR"
        exit 1
    fi
fi

# ── Backend — dependencias Python ─────────────────────────────────────────────

echo ""
echo "==> Instalando dependencias del backend..."
uv sync
ok "Dependencias del backend instaladas."

# ── Node.js / npm ─────────────────────────────────────────────────────────────

echo ""
if ! command -v node &>/dev/null; then
    err "Node.js no encontrado. Instálalo desde https://nodejs.org/ (v18+)"
    warn "Saltando instalación del frontend."
else
    NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
    NODE_MAJOR=${NODE_VERSION%%.*}
    if (( NODE_MAJOR < 18 )); then
        err "Node.js ${NODE_VERSION} es demasiado antiguo. Se requiere v18+."
        warn "Saltando instalación del frontend."
    else
        ok "Node.js ${NODE_VERSION}"

        if ! command -v npm &>/dev/null; then
            err "npm no encontrado. Debe venir incluido con Node.js."
        else
            ok "npm $(npm --version)"
            echo ""
            echo "==> Instalando dependencias del frontend..."
            npm install --prefix frontend
            ok "Dependencias del frontend instaladas."
        fi
    fi
fi

# ── Resumen ───────────────────────────────────────────────────────────────────

echo ""
echo "==> Listo. Para arrancar la aplicación:"
echo ""
echo "    uv run wzcli dev                  ← backend + frontend (desarrollo)"
echo "    uv run wzcli backend serve dev    ← solo backend"
echo "    uv run wzcli frontend dev         ← solo frontend"
echo ""
echo "    uv run wzcli backend test         ← tests del backend"
echo "    uv run wzcli frontend test        ← tests del frontend"
echo "    uv run wzcli docs serve           ← documentación"
echo "    uv run wzcli package build        ← paquete de este sistema (.AppImage / .exe / .dmg)"
echo ""
