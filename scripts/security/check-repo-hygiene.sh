#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: scripts/security/check-repo-hygiene.sh"
  echo "Fails when tracked or unignored runtime data, build artifacts, logs, or generated folders can enter the repository."
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

issues=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if grep -Eq '(^|/)\.(veiron|vireon)-(dev|testnet|mainnet|local)(/|$)|(^|/)(target|target-msvc|node_modules|logs|devnet-data|node-data|\.artifacts|coverage)(/|$)|(^|/)chain\.jsonl$|\.(log|pid|tmp|bak|orig|rej|db|sqlite|exe|dll|msi|AppImage|deb|rpm|apk|aab)$' <<<"$file"; then
    issues+=("Forbidden tracked or unignored artifact: $file")
  fi
  if [[ "$file" == .review/pipeline/runs/* || "$file" == .review/pipeline/worktrees/* ]] && [[ "$file" != .review/pipeline/runs/.gitkeep ]]; then
    issues+=("Forbidden local pipeline artifact: $file")
  fi
  if [[ "$file" == vireon-release/vps-control-plane/state/* && "$file" != vireon-release/vps-control-plane/state/config/generated/.gitkeep && "$file" != vireon-release/vps-control-plane/state/secrets/.gitkeep ]]; then
    issues+=("Forbidden control-plane runtime state: $file")
  fi
done < <((git ls-files; git ls-files --others --exclude-standard) | sort -u)

if (( ${#issues[@]} > 0 )); then
  printf 'Repository hygiene check failed:\n' >&2
  printf -- '- %s\n' "${issues[@]}" >&2
  exit 1
fi

echo "Repository hygiene check passed."
