#!/usr/bin/env bash
# Installs the pinned Chrome for Testing build and prints the absolute path of its binary.
#
# The Hetzner runners are one machine running one user, so a single install under
# /opt/chrome-for-testing serves every runner and every job of a PR run. The script is
# idempotent: an existing install of the pinned version is a no-op, which keeps the CI step
# near-free after the first run on the box. It also runs on a developer machine (pass any
# writable prefix) and on GitHub-hosted runners (pass a directory under RUNNER_TEMP).
#
# Usage: scripts/ci/install-chromium.sh [prefix]   default prefix: ~/.cache/isnadi/chromium
set -euo pipefail

# One exact Chrome for Testing version. Bump it together with the version in
# docs/internals/ci.md so the documented pin and the installed browser never disagree.
CHROME_VERSION="157.0.8103.78"
# chrome-linux64 carries the browser itself, not the headless shell, so the same install drives
# playwright-core now and the web e2e suite later.
CHROME_ARTIFACT="chrome-linux64"

PREFIX="${1:-${HOME}/.cache/isnadi/chromium}"
VERSION_DIR="${PREFIX}/${CHROME_VERSION}"
BINARY="${VERSION_DIR}/${CHROME_ARTIFACT}/chrome"

# An existing install of this exact version is done. Chrome for Testing prints its version, so a
# binary that cannot run fails here instead of skipping a browser test quietly.
if test -x "${BINARY}" && "${BINARY}" --version >/dev/null 2>&1; then
  printf '%s\n' "${BINARY}"
  exit 0
fi

workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

archive="chrome-linux64.zip"
url="https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/${archive}"

mkdir -p "${PREFIX}"
echo "Installing Chrome for Testing ${CHROME_VERSION} into ${PREFIX}" >&2
curl --fail --silent --show-error --location --retry 3 --output "${workdir}/${archive}" "${url}"

# Unpack beside the final path and rename into place, so a job that dies mid-install never leaves
# a partial ${VERSION_DIR} that a later run would take for a working browser.
staging="${PREFIX}/.${CHROME_VERSION}.$$"
rm -rf "${staging}"
mkdir -p "${staging}"
unzip -q "${workdir}/${archive}" -d "${staging}"
rm -rf "${VERSION_DIR}"
mv "${staging}" "${VERSION_DIR}"

if ! "${BINARY}" --version >&2; then
  echo "installed ${BINARY} does not run; remove ${VERSION_DIR} and retry" >&2
  exit 1
fi

printf '%s\n' "${BINARY}"
