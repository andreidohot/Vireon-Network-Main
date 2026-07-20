# Veiron Network Migration Status

> **Document type:** Technical migration register
> **Project stage:** Mainnet Candidate / Experimental Prototype
> **Migration status:** In progress
> **Public-mainnet authorization:** No
> **Real-funds authorization:** No
> **Primary migration target:** `veiron-release/vps-control-plane/`

This document tracks the technical migration of Veiron Network from the older VPS-oriented deployment layout into the current canonical control-plane architecture.

It records:

* what is being migrated;
* why the migration is necessary;
* which components are already migrated;
* which legacy components remain;
* which compatibility risks exist;
* how migrated services are validated;
* what rollback paths are available;
* which conditions must be met before the migration is considered complete.

This document is not a live monitoring dashboard.

Service uptime, current block height, active peers, miner count and endpoint availability must be obtained from live health checks and monitoring systems.

This document is also not a public-mainnet declaration.

Veiron remains a **Mainnet Candidate / experimental network**. VIRE balances, mining rewards and transactions produced during this stage must not be treated as real funds.

---

## 1. Migration objective

The migration exists to replace fragmented, manually operated and partially duplicated VPS deployment logic with one canonical, reproducible and auditable deployment architecture.

The target architecture must make it possible to deploy and operate the Veiron candidate network without depending on undocumented manual actions.

The migration aims to produce:

* one canonical deployment tree;
* one authoritative configuration model;
* reproducible service installation;
* consistent environment validation;
* isolated service responsibilities;
* centralized operational visibility;
* predictable upgrades;
* documented recovery procedures;
* minimal dependency on host-specific state;
* safer handling of secrets;
* explicit rollback paths;
* compatibility between node, RPC, pool, wallet and desktop products.

The target is not merely to move files from one directory to another.

The migration must also remove architectural duplication, hidden assumptions and deployment behavior that cannot be reproduced by another operator.

---

## 2. Canonical migration rule

The canonical deployment tree is:

```text
veiron-release/vps-control-plane/
```

The following tree is legacy:

```text
veiron-release/vps/
```

The legacy tree is considered:

* frozen;
* compatibility-only;
* non-authoritative;
* unsuitable for new features;
* unsuitable for security fixes;
* unsuitable for production-direction development.

No new operational feature should be implemented only inside the legacy tree.

No security patch should be applied exclusively to the legacy tree.

No deployment documentation should instruct new operators to use the legacy tree as the primary installation path.

When behavior differs between the two trees, the canonical control-plane implementation is the intended direction unless a documented migration exception says otherwise.

---

## 3. Why the migration is required

The previous VPS architecture accumulated several structural problems.

### 3.1 Duplicate deployment logic

Installation, configuration and runtime behavior existed in multiple locations.

This created risks such as:

* one deployment path receiving fixes while another remained outdated;
* inconsistent ports;
* different environment-variable names;
* different service names;
* mismatched reverse-proxy rules;
* duplicated configuration templates;
* hidden dependencies on host files;
* inconsistent restart behavior;
* uncertainty about which directory was authoritative.

### 3.2 Manual host dependence

Some operations depended on manual VPS preparation.

Examples include:

* manually creating configuration directories;
* manually copying binaries;
* manually editing reverse-proxy routes;
* manually enabling systemd services;
* manually fixing ownership;
* manually creating missing folders;
* manually setting credentials;
* manually restarting services in a specific order.

These steps are difficult to audit and easy to forget.

### 3.3 Tight coupling between services

The older architecture risked treating the entire Veiron stack as one deployment unit.

This can create cascading failures.

For example:

* a pool failure should not prevent the RPC from starting;
* an explorer failure should not stop the node;
* an admin-panel failure should not stop mining endpoints;
* a monitoring failure should not terminate consensus services;
* a failed optional service should not block release of unrelated components.

The migration must make service boundaries explicit.

### 3.4 Inconsistent remote and local behavior

The desktop application, wallet and miner previously contained assumptions that local node state would always exist.

This conflicted with the remote-VPS operating model.

The target architecture must clearly support:

* local development mode;
* local full-stack mode;
* remote RPC mode;
* solo remote mining;
* pool mining;
* additional full-node operation.

Each mode must declare which local services are required.

### 3.5 Weak operational observability

The previous layout did not provide one consistent source for:

* service status;
* dependency status;
* RPC health;
* node tip;
* pool health;
* disk usage;
* chain-storage state;
* peer connectivity;
* restart counts;
* release version;
* migration version.

The new control plane must make operational state easier to inspect.

---

## 4. Migration scope

The migration covers more than the VPS installer.

It affects every component that relies on the deployment architecture.

### In scope

* node deployment;
* RPC gateway deployment;
* mining-pool deployment;
* admin and operator interface;
* reverse proxy;
* TLS integration;
* Cloudflare integration;
* service configuration;
* systemd or container service definitions;
* persistent storage;
* secrets handling;
* database configuration;
* chain-data placement;
* logs;
* monitoring;
* backup;
* restore;
* health checks;
* upgrade procedures;
* rollback procedures;
* desktop defaults;
* wallet RPC behavior;
* miner endpoint behavior;
* P2P bootstrap configuration;
* release packaging;
* documentation.

### Not automatically authorized by this migration

Completing this migration does not automatically authorize:

* public mainnet;
* real-funds usage;
* production financial settlement;
* exchange listing;
* public token sale;
* production mining-pool payouts;
* claims of decentralization;
* claims of external audit;
* removal of Mainnet Candidate warnings.

---

## 5. Source and target architecture

## 5.1 Legacy architecture

The legacy architecture was primarily host-oriented.

Typical characteristics included:

* direct installation on one VPS;
* service-specific manual configuration;
* host-level reverse proxy;
* manually managed systemd services;
* partially duplicated deployment scripts;
* runtime directories created outside one consistent state model;
* deployment assumptions tied to a specific server;
* limited portability;
* unclear separation between installer and runtime services.

The legacy architecture may still contain useful historical scripts, but it must not be treated as the current source of truth.

## 5.2 Target architecture

The target control-plane architecture should operate as a complete deployment system.

It should provide:

* one installation entry point;
* preflight validation;
* configuration generation;
* service dependency validation;
* node deployment;
* RPC deployment;
* pool deployment;
* monitoring deployment;
* reverse-proxy integration;
* persistent storage preparation;
* secrets initialization;
* health validation;
* upgrade orchestration;
* rollback support;
* uninstall or cleanup behavior;
* web-based operator control where appropriate.

The long-term direction should allow an operator to configure the environment through a controlled interface and then deploy the selected Veiron services consistently.

---

## 6. Migration principles

All migration work should follow these principles.

### 6.1 One source of truth

Each configuration value should have one authoritative source.

Examples:

* network identifier;
* genesis hash;
* RPC port;
* P2P port;
* pool port;
* service names;
* data directories;
* database connection;
* public hostname;
* TLS mode;
* release version.

Derived configuration may be generated, but it should not silently conflict with the source configuration.

### 6.2 Explicit dependencies

Every service must declare:

* what it depends on;
* what depends on it;
* whether it is required;
* whether it is optional;
* what happens if it fails.

### 6.3 Independent service failure

Optional service failure must not unnecessarily stop critical services.

Expected isolation:

| Service failure | Services that should remain available                  |
| --------------- | ------------------------------------------------------ |
| Explorer        | Node, RPC, miner, pool                                 |
| Website         | Node, RPC, pool                                        |
| Admin UI        | Node, RPC, pool                                        |
| Monitoring      | Node, RPC, pool                                        |
| Pool            | Node, RPC, solo mining                                 |
| Indexer         | Node, RPC core endpoints                               |
| RPC             | Node P2P operation                                     |
| Node            | UI may remain reachable but must report degraded state |

### 6.4 Idempotent deployment

Running the deployment process more than once should not:

* duplicate services;
* corrupt configuration;
* reset chain data;
* overwrite secrets;
* delete wallets;
* recreate databases unexpectedly;
* change genesis;
* create conflicting reverse-proxy entries.

### 6.5 Fail-safe behavior

The migration must prefer explicit failure over unsafe fallback.

Examples:

* do not start with default production passwords;
* do not expose operator routes without authentication;
* do not switch networks silently;
* do not recreate missing genesis automatically;
* do not reset chain data during upgrades;
* do not downgrade database schemas silently;
* do not fall back from HTTPS to public HTTP.

### 6.6 Transparent compatibility

Compatibility layers must be documented.

A legacy alias, route or directory should state:

* why it still exists;
* which version requires it;
* when it may be removed;
* what replaces it.

---

## 7. Current migration status

### Overall status

| Area                          | Status                | Notes                                                      |
| ----------------------------- | --------------------- | ---------------------------------------------------------- |
| Canonical control-plane path  | Adopted               | New work belongs under `veiron-release/vps-control-plane/` |
| Legacy VPS tree               | Frozen                | Retained only for history and compatibility                |
| Node service migration        | Operational candidate | Requires further durability and recovery testing           |
| RPC migration                 | Operational candidate | Public-submit boundary requires continued hardening        |
| Pool migration                | Experimental          | Not production payout infrastructure                       |
| Reverse proxy                 | Operational candidate | Needs reproducible configuration ownership                 |
| Desktop remote mode           | Implemented direction | Must remain compatible with control-plane endpoints        |
| Wallet remote-account support | Implemented direction | Requires network and error-path validation                 |
| P2P bootstrap migration       | Partial               | Multi-host soak remains incomplete                         |
| Monitoring integration        | Partial               | Prometheus/Grafana target not fully closed                 |
| Backup and restore            | Partial               | Must be validated with real recovery rehearsals            |
| Upgrade orchestration         | Partial               | Requires versioned migrations and rollback tests           |
| Secrets management            | Partial               | Must eliminate undocumented host secrets                   |
| Container-first deployment    | In progress           | Final architecture should reduce direct-host coupling      |
| Web deployment flow           | Planned/in progress   | Must not bypass security checks                            |
| Cloudflare automation         | Planned/in progress   | Must be optional and credential-safe                       |
| Documentation migration       | In progress           | Legacy instructions must be removed or marked historical   |

---

## 8. Service-by-service migration register

## 8.1 Veiron node

### Migration objective

Move node deployment into a reproducible service definition with explicit configuration and persistent data ownership.

### Required configuration

* network ID;
* genesis path or genesis hash;
* P2P listen address;
* P2P public address;
* seed peers;
* chain-data path;
* mempool path;
* log path;
* protocol version;
* storage mode;
* restart policy;
* resource limits;
* health-check behavior.

### Current migrated behavior

The node can operate as the authoritative chain source for:

* RPC;
* solo miners;
* pool;
* indexer;
* explorer.

P2P behavior includes candidate-level protections such as:

* rejecting incompatible protocol peers;
* redialing seeds when no validated peer exists;
* handshake timeout;
* avoiding bootstrap self-dial;
* rejecting peers that advertise no compatible Veiron synchronization protocol.

### Remaining migration work

* production storage backend or segmented durable storage;
* multi-host synchronization soak;
* disk corruption recovery;
* clean recovery after interrupted writes;
* versioned chain migrations;
* explicit downgrade prevention;
* peer reputation operational review;
* resource-limit validation;
* backup and restore automation;
* chain snapshot policy;
* monitored storage growth.

### Migration acceptance criteria

The node migration is complete only when:

* a clean host can deploy the node from canonical tooling;
* existing chain data can be imported without corruption;
* restart does not alter genesis or network ID;
* failed upgrades can be rolled back;
* backup and restore preserve the exact tip;
* multiple independent nodes synchronize consistently;
* incompatible peers are rejected safely;
* node data survives service recreation.

---

## 8.2 RPC gateway

### Migration objective

Provide one versioned and protected interface between the node and external products.

### Required responsibilities

* node status;
* chain queries;
* address state;
* transaction submission;
* mining templates;
* block submission;
* indexer-backed query routes;
* operator-only routes;
* health and readiness;
* access-mode declaration.

### Current migrated behavior

The candidate RPC supports remote wallet and mining use.

Important migrated behavior includes:

* remote account-state lookup;
* balance retrieval;
* next-nonce retrieval;
* current tip context;
* mining-template retrieval;
* mining submission;
* pool upstream communication;
* candidate status reporting.

### Access modes

The control plane must distinguish at least:

```text
loopback
private
public-read
public-submit
operator
```

The meaning of each mode must be explicit.

`public-submit` must not imply that operator or administrative endpoints are public.

### Remaining migration work

* in-process rate limiting;
* durable abuse controls;
* request-body limits;
* endpoint-specific timeouts;
* operator endpoint isolation;
* load testing;
* error-schema standardization;
* versioned API compatibility;
* metrics per endpoint;
* request correlation IDs;
* reverse-proxy trust configuration;
* documented CORS policy;
* mining abuse testing.

### Migration acceptance criteria

* wallet, miner, pool and explorer use the same documented API version;
* public endpoints are intentionally exposed;
* private endpoints cannot be reached publicly;
* health checks distinguish alive, ready and degraded states;
* reverse-proxy failure is detectable;
* RPC restart does not stop the node;
* endpoint limits are tested under load.

---

## 8.3 Mining pool

### Migration objective

Move the experimental pool into the canonical deployment system while preserving its prototype classification.

### Current responsibilities

* issue mining work;
* validate shares;
* track workers;
* manage variable difficulty;
* submit full block candidates;
* track immature rewards;
* confirm matured rewards;
* expose pool status.

### Important limitation

The mining pool is not approved for production financial payouts.

Pool balances and rewards remain experimental.

They must not be represented as real money or guaranteed future claims.

### Remaining migration work

* production database;
* multi-instance coordination;
* shared admission control;
* payout transaction creation;
* isolated or offline signer;
* hardware-backed signing research;
* payout idempotency;
* payout retry policy;
* accounting audit trail;
* worker authentication options;
* DDoS protection;
* stratum compatibility review;
* reorg-safe reward handling;
* disaster recovery;
* pool version compatibility enforcement.

### Migration acceptance criteria

The infrastructure migration can be considered operational when:

* pool deployment is reproducible;
* pool failure does not stop node or RPC;
* shares are validated consistently;
* invalid workers cannot exhaust resources trivially;
* reorgs do not create duplicate unpaid or paid balances;
* pool state survives service restart;
* pool version matches the network protocol.

Production payout approval requires a separate security and financial gate.

---

## 8.4 Indexer

### Migration objective

Provide a recoverable, bounded and version-aware index of chain data.

### Current migrated direction

* tip-hash verification;
* rebuild detection;
* atomic index writes;
* bounded overview routes;
* pagination;
* read-only RPC cache behavior.

### Remaining migration work

* continuous daemon operation;
* incremental detach during reorg;
* versioned index schema;
* resumable indexing;
* database durability;
* index corruption detection;
* lag monitoring;
* rebuild estimation;
* low-disk protection;
* API compatibility policy.

### Acceptance criteria

* indexer can rebuild from node data;
* indexer corruption does not corrupt the node;
* explorer reports index lag;
* reorgs are reflected correctly;
* index data survives service recreation;
* indexer failure does not stop consensus operation.

---

## 8.5 Explorer

### Migration objective

Decouple the explorer from host-specific assumptions and connect it only through documented APIs.

### Required behavior

* no direct wallet-key access;
* no direct chain-data mutation;
* no dependence on local filesystem paths;
* visible network label;
* visible candidate warning;
* graceful degraded state;
* indexer lag visibility;
* no claims of monetary value.

### Remaining migration work

* environment-driven endpoint configuration;
* static build version tracking;
* API compatibility checking;
* CSP hardening;
* cached read-only deployment;
* accessible error reporting;
* candidate-network warning consistency.

---

## 8.6 Desktop Control Center

### Migration objective

Make the desktop application compatible with both local and remote operation without requiring hidden local services.

### Supported operating modes

#### Remote candidate mode

Uses a configured remote RPC and optional remote pool.

Local services should not be started unless explicitly enabled.

#### Local full-stack mode

Runs or controls local node, RPC, wallet, miner and supporting services.

#### Remote solo-mining mode

Uses remote RPC mining endpoints.

#### Pool-mining mode

Uses the configured pool endpoint.

### Current migrated behavior

The desktop direction includes:

* remote RPC as a valid primary source;
* remote pool configuration;
* local stack disabled in remote mode;
* miner launched against selected endpoint;
* wallet account data retrieved remotely.

### Remaining migration work

* strict network-ID verification;
* genesis-hash verification;
* TLS certificate error handling;
* endpoint trust warnings;
* automatic compatibility checks;
* version mismatch reporting;
* safer update rollback;
* signed release verification;
* better degraded-mode reporting;
* migration of desktop settings;
* prevention of accidental candidate/mainnet confusion.

### Acceptance criteria

* remote mode works without local chain files;
* local mode does not use remote services unexpectedly;
* network mismatch blocks signing or broadcasting;
* invalid endpoints produce clear errors;
* desktop updates preserve wallet data;
* desktop uninstall does not remove wallet data without explicit confirmation.

---

## 8.7 Admin and control interface

### Migration objective

Provide a controlled operator interface for deployment and service management.

### Allowed responsibilities

* environment validation;
* service deployment;
* configuration generation;
* start and stop operations;
* health overview;
* log access;
* version display;
* backup operations;
* upgrade operations;
* rollback operations;
* operator alerts.

### Security requirements

* authentication mandatory;
* no default production credentials;
* session expiry;
* CSRF protection;
* audit logging;
* rate limiting;
* least-privilege execution;
* secrets masked in UI;
* no mnemonic or wallet-key display;
* no arbitrary command execution from untrusted input;
* explicit confirmation for destructive actions.

### Remaining migration work

* role separation;
* API authentication;
* action audit trail;
* safe job queue;
* deployment-state locking;
* rollback state;
* secret rotation;
* controlled Cloudflare integration;
* separation of read-only and destructive actions.

---

## 8.8 Reverse proxy and TLS

### Migration objective

Make public routing reproducible and independent from manual control-panel configuration.

### Required routes

Routes may include:

```text
/status
/addresses/
/transactions/
/blocks/
/mining/
/pool/
/control/
/metrics/
```

Not every route should be public.

### Requirements

* HTTPS;
* explicit upstreams;
* request-size limits;
* timeout limits;
* CORS policy;
* security headers;
* WebSocket support where required;
* no accidental operator-route exposure;
* health-aware upstream behavior;
* configuration validation before reload.

### Remaining migration work

* canonical proxy templates;
* Cloudflare and direct-TLS modes;
* automated certificate validation;
* trusted proxy configuration;
* rate-limiting policy;
* route ownership documentation;
* safe reload rollback.

---

## 9. Data migration

Data migration is the highest-risk part of the control-plane transition.

### Data classes

| Data class       | Migration requirement                                          |
| ---------------- | -------------------------------------------------------------- |
| Chain data       | Preserve exact block order, hashes and genesis                 |
| Mempool          | May be rebuilt; must not be treated as durable financial state |
| Wallet data      | Must never be moved without explicit protection and backup     |
| Pool accounting  | Must preserve worker balances and maturity state               |
| Index data       | Rebuildable from chain; should not be treated as authoritative |
| Configuration    | Must be versioned and validated                                |
| Secrets          | Must be transferred securely, never committed                  |
| Logs             | Optional historical retention                                  |
| Metrics          | Optional historical retention                                  |
| Release metadata | Must preserve version and checksum history                     |

### Chain migration requirements

Before migration:

1. stop block-producing services or enter controlled maintenance;
2. record current height;
3. record current tip hash;
4. record genesis hash;
5. create a backup;
6. verify backup readability;
7. record file checksums;
8. verify available disk space.

After migration:

1. start node without miners;
2. verify genesis;
3. verify height;
4. verify tip hash;
5. validate structural chain continuity;
6. verify account state;
7. verify RPC status;
8. start indexer;
9. compare indexed tip;
10. enable miners only after consistency checks pass.

### Wallet migration requirements

Wallet files must:

* remain encrypted;
* retain original ownership;
* preserve backups;
* not be copied into containers unintentionally;
* not be stored in Git;
* not be exposed through admin interfaces;
* not be mounted into unrelated services.

### Pool migration requirements

Pool accounting must preserve:

* worker identities;
* accepted shares where required;
* immature balances;
* mature unpaid balances;
* paid transaction references;
* payout idempotency records;
* block-candidate history.

No migration should mark experimental balances as real financial obligations.

---

## 10. Configuration migration

Configuration must move from ad hoc host files into a versioned model.

Each configuration schema should include:

```text
schema_version
deployment_version
network_id
genesis_hash
service_name
service_version
environment
data_path
public_hostname
listen_address
public_address
dependency_endpoints
security_mode
migration_version
```

### Configuration rules

* unknown fields should be reported;
* missing required fields should stop deployment;
* network ID changes must require explicit approval;
* genesis changes must require explicit approval;
* secrets must not be written into public logs;
* generated configs must show their source;
* config migrations must be versioned;
* downgrade behavior must be documented.

---

## 11. Container migration direction

The target architecture is container-first where technically appropriate.

Containerization should provide:

* reproducible runtime dependencies;
* isolated services;
* explicit volumes;
* explicit networks;
* health checks;
* restart policies;
* easier upgrades;
* simpler host migration;
* consistent monitoring.

Containerization does not solve every problem automatically.

It must not introduce:

* ephemeral chain storage;
* shared writable volumes between unrelated services;
* secrets inside images;
* root containers without need;
* floating image tags;
* automatic destructive migrations;
* hidden host networking;
* unbounded log growth.

### Recommended service separation

```text
veiron-installer
veiron-control-plane
veiron-node
veiron-rpc
veiron-indexer
veiron-explorer
veiron-mining-pool
veiron-monitoring
prometheus
grafana
reverse-proxy
database
```

Not every environment must run every service.

---

## 12. Monitoring migration

The migration should integrate Prometheus-compatible metrics and Grafana dashboards.

### Required node metrics

* current height;
* tip age;
* peer count;
* validated peer count;
* block acceptance count;
* block rejection count;
* mempool size;
* chain-storage size;
* reorg count;
* RPC dependency status;
* process memory;
* process CPU;
* restart count.

### Required RPC metrics

* request count;
* response status;
* request latency;
* endpoint errors;
* rate-limit events;
* active requests;
* upstream refresh failures;
* chain lag.

### Required pool metrics

* connected workers;
* active jobs;
* accepted shares;
* rejected shares;
* invalid shares;
* upstream block submissions;
* immature rewards;
* mature rewards;
* payout failures;
* node connectivity.

### Required infrastructure alerts

* node not advancing;
* node tip too old;
* no validated peers;
* RPC unavailable;
* pool upstream unavailable;
* disk nearly full;
* repeated restart;
* backup failure;
* TLS expiry;
* database unavailable;
* indexer lag;
* chain-data corruption signal.

---

## 13. Backup and restore migration

A backup is not considered valid until it has been restored successfully.

### Backup scope

* chain data;
* node configuration;
* RPC configuration;
* pool database;
* admin configuration;
* reverse-proxy configuration;
* release metadata;
* required secrets through a secure secret-backup process.

Wallet backups should remain separate from infrastructure backups.

### Backup requirements

* timestamped;
* checksum-verified;
* encrypted where sensitive;
* stored outside the primary host;
* retained according to policy;
* tested through restoration;
* documented with network ID and genesis hash.

### Restore acceptance criteria

* node starts;
* genesis matches;
* tip matches expected backup state;
* account state is consistent;
* pool balances are consistent;
* indexer rebuilds or resumes;
* services reconnect correctly;
* no secrets appear in logs.

---

## 14. Upgrade migration

Every upgrade should follow a defined sequence.

### Standard upgrade flow

1. verify release checksum;
2. verify release approval;
3. inspect migration notes;
4. back up data;
5. record current versions;
6. stop affected services only;
7. run configuration migration;
8. run database migration;
9. deploy new binaries or images;
10. start dependencies first;
11. run readiness checks;
12. verify chain height and tip;
13. verify RPC compatibility;
14. verify pool and indexer;
15. re-enable traffic;
16. monitor for regression.

### Upgrade isolation

A failed optional component must not force rollback of an unrelated healthy service unless the release contains a shared protocol incompatibility.

### Protocol upgrade warning

Consensus changes require a separate coordinated network upgrade.

They must not be deployed as ordinary service updates.

---

## 15. Rollback strategy

Rollback must be possible for:

* binary versions;
* container images;
* configuration;
* database schemas where supported;
* reverse-proxy configuration;
* desktop release;
* control-plane release.

### Rollback must not

* change genesis;
* reset chain data;
* delete wallets;
* duplicate pool payouts;
* broadcast transactions twice;
* silently downgrade incompatible chain formats.

### Rollback triggers

* node fails structural validation;
* tip differs unexpectedly;
* RPC returns incompatible data;
* pool submits invalid blocks;
* indexer corrupts query state;
* reverse proxy exposes protected endpoints;
* authentication fails open;
* storage migration cannot complete;
* upgrade causes repeated restart;
* desktop signs against the wrong network.

---

## 16. Security migration

The migration must remove insecure transitional behavior.

### Required controls

* no default passwords;
* no committed secrets;
* no public operator API;
* explicit access modes;
* minimal exposed ports;
* authenticated administrative actions;
* TLS validation;
* container image pinning;
* checksum validation;
* release provenance;
* least privilege;
* audit logs;
* secret rotation;
* destructive-action confirmation.

### Secrets that require protection

* database passwords;
* admin credentials;
* RPC operator tokens;
* Cloudflare API tokens;
* TLS private keys;
* release signing keys;
* pool payout keys;
* monitoring credentials;
* backup encryption keys.

Wallet mnemonic phrases and private keys should not be managed by the general control plane.

---

## 17. Known migration risks

| Risk                                     | Impact                                 | Mitigation                                    |
| ---------------------------------------- | -------------------------------------- | --------------------------------------------- |
| Legacy and canonical paths diverge       | Operators deploy outdated code         | Freeze legacy tree and mark all legacy docs   |
| Wrong network ID                         | Accidental fork or incompatible client | Validate network ID at startup                |
| Wrong genesis                            | Separate irreversible chain            | Pin and verify genesis hash                   |
| Lost chain volume                        | Chain reset or data loss               | Explicit persistent volumes and restore tests |
| Pool accounting loss                     | Incorrect experimental balances        | Versioned DB backups and migration checks     |
| Secrets copied into images               | Credential compromise                  | Runtime secret injection                      |
| Reverse proxy exposes admin route        | Remote compromise                      | Route allowlists and auth tests               |
| Desktop connects to wrong network        | Invalid or unintended transactions     | Network and genesis verification              |
| Service dependency loop                  | Deployment failure                     | Explicit dependency graph                     |
| One optional service blocks all releases | Unnecessary outage                     | Independent workflows and artifacts           |
| Database migration failure               | Service downtime                       | Preflight, backup and rollback                |
| Automatic config overwrite               | Loss of operator settings              | Merge-aware versioned migration               |
| Container runs as root                   | Host compromise risk                   | Least-privilege users                         |
| Monitoring absent                        | Failures remain unnoticed              | Mandatory health and alert baseline           |

---

## 18. Legacy deprecation plan

The legacy tree should be removed only after:

* all active services are available through the canonical control plane;
* operators no longer depend on legacy scripts;
* all required configuration has migrated;
* documentation links have been updated;
* backup and restore have been tested;
* rollback does not require legacy deployment;
* desktop defaults match canonical endpoints;
* no release workflow packages the legacy tree;
* no security patch exists only in legacy code.

Until deletion, the legacy directory should contain a visible warning such as:

```text
LEGACY / FROZEN

Do not use this tree for new deployments.
Do not add features here.
Do not apply security fixes only here.
Use ../vps-control-plane/ instead.
```

---

## 19. Migration validation matrix

| Validation                   | Required result                                          |
| ---------------------------- | -------------------------------------------------------- |
| Clean installation           | All selected services deploy without manual hidden steps |
| Repeated installation        | No duplication or destructive reset                      |
| Node restart                 | Same network, genesis, height and data                   |
| RPC restart                  | Node continues operating                                 |
| Pool restart                 | Node and solo mining remain available                    |
| Explorer failure             | Consensus services remain available                      |
| Monitoring failure           | Consensus services remain available                      |
| Host reboot                  | Services recover in correct order                        |
| Disk-pressure test           | Alerts fire before corruption                            |
| Backup restore               | Chain and service state recover                          |
| Network mismatch             | Client connection rejected or warned                     |
| Version mismatch             | Clear compatibility error                                |
| Invalid config               | Deployment stops before destructive action               |
| Reverse-proxy reload failure | Previous config remains active                           |
| Secret scan                  | No production secrets in repository or image             |
| Legacy scan                  | No active release depends on legacy path                 |
| Multi-host test              | Nodes synchronize and preserve same tip                  |
| Reorg test                   | Node, pool and indexer reconcile consistently            |

---

## 20. Migration completion gates

## Gate M0 — Inventory complete

Requirements:

* all legacy services identified;
* all directories identified;
* all ports documented;
* all persistent data documented;
* all secrets documented by type;
* all dependencies mapped.

## Gate M1 — Canonical packaging

Requirements:

* control-plane tree is authoritative;
* installer is reproducible;
* configuration schema is versioned;
* legacy tree is frozen;
* release artifacts use canonical packaging.

## Gate M2 — Service parity

Requirements:

* node parity;
* RPC parity;
* pool parity where applicable;
* indexer parity;
* explorer parity;
* admin parity;
* desktop compatibility.

Parity means required behavior exists, not that historical bugs must be reproduced.

## Gate M3 — Data safety

Requirements:

* chain migration tested;
* configuration migration tested;
* pool-state migration tested;
* backup created;
* restore completed;
* rollback completed;
* wallet data isolated.

## Gate M4 — Operational maturity

Requirements:

* monitoring;
* alerts;
* service isolation;
* restart validation;
* upgrade flow;
* rollback flow;
* incident runbook;
* capacity review.

## Gate M5 — Legacy retirement

Requirements:

* no active dependency on legacy tree;
* documentation updated;
* release workflows updated;
* operators migrated;
* final archive created;
* legacy deletion approved.

Completing M5 does not authorize public mainnet.

Public-mainnet authorization remains governed by the separate G4 requirements in:

```text
docs/release/NETWORK_MATURITY.md
```

---

## 21. Outstanding migration work

The following work remains open or requires final verification:

* complete container-first deployment;
* finalize service dependency graph;
* implement web-based deployment workflow;
* integrate Prometheus;
* integrate Grafana;
* define production monitoring dashboards;
* add canonical reverse-proxy generation;
* add optional Cloudflare automation;
* protect Cloudflare credentials;
* migrate remaining host-created directories;
* version all configuration schemas;
* add database migration tracking;
* add explicit rollback state;
* validate chain-data restore;
* validate pool-state restore;
* complete multi-host P2P soak;
* complete node storage durability work;
* add production-grade rate limits;
* add operator audit logs;
* isolate destructive admin actions;
* remove outdated legacy documentation;
* ensure release workflows are independent;
* ensure one failed component does not block unrelated release artifacts;
* document all migration exceptions;
* perform a final legacy dependency scan.

---

## 22. Operational status versus migration status

These concepts must not be confused.

### Operational status

Answers:

* Is the service running now?
* Is the RPC responding now?
* What is the current chain height?
* Is the pool reachable?
* How many peers are connected?

Operational status changes continuously.

### Migration status

Answers:

* Has the service moved to the canonical architecture?
* Is its data migrated?
* Is its configuration versioned?
* Is rollback tested?
* Is legacy dependency removed?
* Is the deployment reproducible?

A service can be operational while its migration is incomplete.

A service can be fully migrated while temporarily offline.

---

## 23. Mainnet Candidate and real-funds restriction

The migration may produce a stable and publicly reachable candidate infrastructure.

That does not make the network a production financial system.

During the current stage:

* VIRE is an experimental protocol unit;
* candidate balances may be reset;
* candidate balances have no guaranteed conversion;
* candidate mining rewards are not guaranteed income;
* pool balances are not real-funds obligations;
* wallet balances must not be presented as fiat value;
* the infrastructure must not claim exchange readiness;
* operators must not market candidate access as an investment.

No migration milestone authorizes removal of these restrictions.

---

## 24. Document ownership and update rules

This document should be updated when:

* a service completes migration;
* a new migration blocker is discovered;
* a rollback is tested;
* a data migration is completed;
* a legacy dependency is removed;
* the target architecture changes;
* a migration gate is completed.

This document should not be updated merely to record:

* temporary block height;
* current uptime;
* current miner count;
* one-time service restarts;
* short-lived endpoint incidents.

Those belong in monitoring, incident reports or deployment logs.

### Change-control rule

When migration status changes:

1. update this document;
2. update relevant deployment documentation;
3. update configuration examples;
4. update the canonical control-plane code;
5. update legacy warnings if required;
6. verify that `NETWORK_MATURITY.md` still uses the correct project status.

---

## 25. Current conclusion

Veiron Network has already moved important operational behavior toward a canonical control-plane model.

The node, RPC gateway, remote wallet flow, miner connectivity, pool routing and desktop remote-mode direction have candidate-level implementations.

However, the migration is not complete.

The largest remaining tasks are:

* removing host-specific assumptions;
* finishing container-first deployment;
* ensuring service independence;
* making configuration migrations explicit;
* validating data restoration;
* improving monitoring;
* hardening public RPC boundaries;
* completing multi-host P2P validation;
* establishing reliable upgrade and rollback procedures;
* retiring all active dependencies on the legacy VPS tree.

The migration should be considered successful only when a new operator can deploy, validate, upgrade, recover and monitor the Veiron candidate infrastructure using the canonical control plane without relying on undocumented knowledge from the original host.

Until then, the migration remains in progress.

---

## Related documents

```text
README.md
docs/release/NETWORK_MATURITY.md
docs/release/MAINNET_CANDIDATE_CHECKLIST.md
docs/release/RELEASE_GATE.md
docs/security/SECURITY_GATE.md
docs/operator/
veiron-release/vps-control-plane/
```

---

**Last reviewed:** 2026-07-20
**Status:** Migration in progress
**Canonical target:** `veiron-release/vps-control-plane/`
**Legacy path:** `veiron-release/vps/` — frozen
**Network classification:** Mainnet Candidate / Experimental Prototype
**Real-funds usage:** Not authorized
