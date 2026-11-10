#!/bin/bash

# Prefer the Node.js version selected by Volta during setup.
if [[ -d "${VOLTA_HOME:-${HOME:-}/.volta}/bin" ]]; then
    export PATH="${VOLTA_HOME:-${HOME:-}/.volta}/bin:$PATH"
elif command -v cygpath >/dev/null 2>&1 && [[ -n "${PROGRAMFILES:-${ProgramFiles:-}}" ]]; then
    VOLTA_WINDOWS_DIR="$(cygpath -u "${PROGRAMFILES:-${ProgramFiles:-}}")/Volta"
    [[ -d "$VOLTA_WINDOWS_DIR" ]] && export PATH="$VOLTA_WINDOWS_DIR:$PATH"
fi

cd frontend
npm run dev
