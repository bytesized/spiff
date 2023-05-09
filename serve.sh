#!/bin/bash

script_rel_dir="$(dirname "${BASH_SOURCE[0]}")"
cd "${script_rel_dir}/src"

python3 -m http.server 8000
