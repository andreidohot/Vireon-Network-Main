#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: scripts/security/check-config-safety.sh"
  echo "Fails when repository config files expose unsafe RPC settings, devnet data paths in mainnet-candidate configs, reset flags, secrets, or local wallet material."
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

allowed_placeholder_regex='CHANGE_ME|example|localhost|127\.0\.0\.1'
secret_patterns=(
  "PRIVATE_KEY="
  "WALLET_SEED="
  "MNEMONIC="
  "API_TOKEN="
  "GITHUB_TOKEN="
  "SECRET="
  "PASSWORD="
  "RPC_PASSWORD="
  "ADMIN_TOKEN="
)

issues=()
config_files=()

while IFS= read -r file; do
  [[ -n "$file" ]] && config_files+=("$file")
done < <(find configs vireon-rpc-gateway/config vireon-devnet/config -type f -name "*.toml" 2>/dev/null | sort -u)

for file in "${config_files[@]}"; do
  content="$(cat "$file")"

  if grep -Eq '^[[:space:]]*bind_host[[:space:]]*=[[:space:]]*"0\.0\.0\.0"' <<<"$content" && ! grep -Eq '^[[:space:]]*public_rpc_allowed[[:space:]]*=[[:space:]]*true' <<<"$content"; then
    issues+=("Unsafe RPC bind without public opt-in: $file")
  fi
  if [[ "$file" == *mainnet-candidate*.toml ]] && grep -Eq '\.vireon-dev' <<<"$content"; then
    issues+=("Mainnet-candidate config uses devnet data path: $file")
  fi
  if [[ "$file" == *mainnet-candidate*.toml ]] && grep -Eiq '^[[:space:]]*(allow_reset|reset)[[:space:]]*=[[:space:]]*true[[:space:]]*$' <<<"$content"; then
    issues+=("Mainnet-candidate config enables reset-like behavior: $file")
  fi

  for pattern in "${secret_patterns[@]}"; do
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      if grep -Eiq "$allowed_placeholder_regex" <<<"$line"; then
        continue
      fi
      issues+=("Secret pattern '$pattern' found in config ${file}:${line%%:*}")
    done < <(grep -nF "$pattern" "$file" || true)
  done
done

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if [[ "$file" == vireon-wallet/* ]]; then
    continue
  fi
  issues+=("Wallet material inside repository tree: $file")
done < <(find . -path ./vireon-wallet -prune -o -type f \( -path "*/wallets/*" -o -name "*.wallet" -o -name "*.seed" -o -name "*.key" -o -name "*.pem" \) -print)

if (( ${#issues[@]} > 0 )); then
  printf 'Config safety check failed:\n' >&2
  printf -- '- %s\n' "${issues[@]}" >&2
  exit 1
fi

echo "Config safety check passed."
