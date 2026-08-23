#!/usr/bin/env bash
# ============================================================================
#  deploy.sh — install the LodgeIT Booking Website service on webbox.
#
#  Run as root from the deploy checkout (/root/BookingEngine/LodgeITBookingWebsite):
#      ./deploy/deploy.sh
#
#  The service is zero-dependency node (no npm install, no build step), so a
#  deploy is: pull main (showing what changed), sync the files into
#  /opt/lodgeit-site, restart the lodgeit-site service, verify /health.
#
#  Configuration lives ONLY in /opt/lodgeit-site/.env (wiring: port, engine
#  URL, this service's client key/secret) — the sync never touches it. The
#  'site' client itself is created on the Lodge Ops Booking Engine page
#  (Service clients card), never by hand in the engine database.
#
#  Your shell stays wherever you ran it from — the script never changes the
#  caller's directory.
# ============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="/opt/lodgeit-site"
SERVICE="lodgeit-site"
UNIT_FILE="/etc/systemd/system/${SERVICE}.service"
ENV_FILE="${APP_ROOT}/.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "!! Run as root — this script writes ${APP_ROOT} and restarts ${SERVICE}." >&2
  exit 1
fi
if [[ ! -f "${REPO_DIR}/VERSION" || ! -f "${REPO_DIR}/server/src/server.mjs" ]]; then
  echo "!! ${REPO_DIR} does not look like the website repo (VERSION / server/src/server.mjs missing)." >&2
  exit 1
fi

# The port the site listens on — from the installed .env, default 3200.
PORT=3200
if [[ -f "${ENV_FILE}" ]]; then
  PORT="$(grep -E '^PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2 || true)"
  PORT="${PORT:-3200}"
fi

health_field() {  # health_field <json> <field>  → value or empty
  node -e '
    try {
      const j = JSON.parse(process.argv[1]);
      const v = j[process.argv[2]];
      if (v !== undefined && v !== null) console.log(v);
    } catch {}
  ' "$1" "$2"
}

# ---- 1. Pull, showing what changed ----
echo "==> Pulling main into ${REPO_DIR}…"
OLD_HEAD="$(git -C "${REPO_DIR}" rev-parse HEAD)"
git -C "${REPO_DIR}" pull --ff-only --quiet origin main || {
  echo "!! Pull refused to fast-forward. This checkout is deploy-only — never" >&2
  echo "!! commit or edit here. Fix the divergence; do not force through."     >&2
  exit 1
}
NEW_HEAD="$(git -C "${REPO_DIR}" rev-parse HEAD)"
if [[ "${OLD_HEAD}" == "${NEW_HEAD}" ]]; then
  echo "==> Already up to date: $(git -C "${REPO_DIR}" log -1 --format='%h %s')"
else
  echo "==> New commits:"
  git -C "${REPO_DIR}" --no-pager log --oneline --no-decorate "${OLD_HEAD}..${NEW_HEAD}"
  echo "==> Files changed:"
  git -C "${REPO_DIR}" --no-pager diff --stat "${OLD_HEAD}" "${NEW_HEAD}"
fi
APP_VERSION="$(cat "${REPO_DIR}/VERSION")"
echo "==> Deploying v${APP_VERSION}"

# ---- 2. Install (no build — zero-dependency service) ----
echo "==> Installing into ${APP_ROOT}…"
mkdir -p "${APP_ROOT}"
rsync -a --delete --exclude .git --exclude .env --exclude data "${REPO_DIR}/" "${APP_ROOT}/"
chown -R oase:oase "${APP_ROOT}"

# ---- 3. First-run gates: .env and the unit ----
if [[ ! -f "${ENV_FILE}" ]]; then
  cat >&2 <<EOF
!! ${ENV_FILE} does not exist. Files are installed, but the service was NOT
!! restarted. Create it (owner oase, mode 600) with the wiring only:
     PORT=3200
     ENGINE_URL=http://127.0.0.1:3100
     CLIENT_KEY=site
     CLIENT_SECRET=…   # generated on the Lodge Ops Booking Engine page
     SITE_PUBLIC_URL=https://lodgeops.7starlodges.com/book/
!! then run this script again.
EOF
  exit 1
fi
chown oase:oase "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
if [[ ! -f "${UNIT_FILE}" ]]; then
  echo "!! ${UNIT_FILE} does not exist — install the unit (see the runbook," >&2
  echo "!! phase 7), systemctl daemon-reload, then run this script again."   >&2
  exit 1
fi

# ---- 4. Restart + verify ----
echo "==> Restarting ${SERVICE}…"
systemctl restart "${SERVICE}"

echo "==> Waiting for /health on :${PORT}…"
HEALTH=""
for _ in $(seq 1 15); do
  sleep 1
  HEALTH="$(curl -s --max-time 2 "http://127.0.0.1:${PORT}/health" || true)"
  [[ -n "${HEALTH}" ]] && break
done
if [[ -z "${HEALTH}" ]]; then
  echo "!! The site did not answer /health within 15s. Check:" >&2
  echo "     journalctl -u ${SERVICE} --since '2 min ago' --no-pager" >&2
  exit 1
fi

OK="$(health_field "${HEALTH}" ok)"
LIVE_VERSION="$(health_field "${HEALTH}" version)"
ENGINE_OK="$(health_field "${HEALTH}" engineReachable)"
echo "==> Health: ok=${OK:-?} version=${LIVE_VERSION:-?} engineReachable=${ENGINE_OK:-?}"

FAIL=0
if [[ "${OK}" != "true" ]]; then
  echo "!! Health reports ok=${OK:-false}." >&2
  FAIL=1
fi
if [[ "${LIVE_VERSION}" != "${APP_VERSION}" ]]; then
  echo "!! Running version ${LIVE_VERSION:-?} does not match the repo's ${APP_VERSION} — the deploy did not land." >&2
  FAIL=1
fi
if (( FAIL )); then exit 1; fi

if [[ "${ENGINE_OK}" != "true" ]]; then
  echo "** WARNING: the site is up but cannot reach the engine (ENGINE_URL in ${ENV_FILE},"
  echo "** engine service, or an inactive/mismatched 'site' client). Guests see the static"
  echo "** site with a calm 'bookings unavailable' state until this is fixed."
fi

echo "==> Done. LodgeIT Booking Website v${APP_VERSION} is live on :${PORT}."
