# Secret Handling

Status: Draft / Mainnet Candidate / Prototype

Vireon repository rule: never commit secrets.

Forbidden in repository history or working files:
- `.env`
- `.env.*`
- private keys
- wallet seeds
- mnemonic phrases
- tokens
- passwords
- wallet files

Allowed:
- `.env.example`
- placeholder values such as `CHANGE_ME`, `example`, `localhost`

Operational rules:
- wallet files stay local only, outside repository folders;
- use GitHub Secrets for CI credentials when CI needs external access;
- keep RPC bound to localhost by default;
- do not place `.vireon-dev/`, `.vireon-testnet/` or `.vireon-mainnet/` inside commits.

Verification commands:

```powershell
scripts/security/check-secrets.ps1
scripts/security/check-repo-hygiene.ps1
```
