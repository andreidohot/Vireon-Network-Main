from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
CONFIG=ROOT/'veiron-release/vps-control-plane/admin-server/src/config.rs'
APP=ROOT/'veiron-release/vps-control-plane/admin-server/src/app.rs'
def one(s,o,n,label):
 c=s.count(o)
 if c!=1: raise SystemExit(f'{label}: expected 1 match, found {c}')
 return s.replace(o,n,1)
c=CONFIG.read_text()
if 'use std::env;' not in c: c=one(c,'use serde::Deserialize;\n','use serde::Deserialize;\nuse std::env;\n','config import')
if 'let docker_mode = env::var' not in c: c=one(c,'    pub fn validate(&self) -> Result<(), String> {\n        let bind_ip: IpAddr = self\n','    pub fn validate(&self) -> Result<(), String> {\n        let docker_mode = env::var("VEIRON_DEPLOYMENT_MODE").map(|v| v.eq_ignore_ascii_case("docker")).unwrap_or(false);\n        let bind_ip: IpAddr = self\n','docker mode')
c=c.replace('        if !bind_ip.is_loopback() {\n','        if !bind_ip.is_loopback() && !docker_mode {\n',1)
old='''        if !self.local_rpc_url.starts_with("http://127.0.0.1:")
            && !self.local_rpc_url.starts_with("http://[::1]:")
        {
            return Err("local_rpc_url must use loopback HTTP".to_owned());
        }
'''
new='''        if !self.local_rpc_url.starts_with("http://127.0.0.1:")
            && !self.local_rpc_url.starts_with("http://[::1]:")
            && !(docker_mode && self.local_rpc_url.starts_with("http://veiron-rpc:"))
        {
            return Err("local_rpc_url must use loopback HTTP or Docker-internal veiron-rpc".to_owned());
        }
'''
if 'Docker-internal veiron-rpc' not in c: c=one(c,old,new,'rpc validation')
CONFIG.write_text(c)
a=APP.read_text()
if 'use std::env;' not in a: a=one(a,'use serde_json::{json, Value};\n','use serde_json::{json, Value};\nuse std::env;\n','app import')
if 'Docker enrollment requires release_bundle_url' not in a:
 start=a.index('    let install_command = format!('); end=a.index('    let steps = vec![',start)
 block=r'''    let install_command = if docker_mode() {
        if state.config.release_bundle_url.trim().is_empty() { return Err(bad_request("Docker enrollment requires release_bundle_url to point to the secure stack ZIP")); }
        format!(r#"set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl git unzip
command -v docker >/dev/null || (curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh)
rm -rf /opt/veiron-agent /tmp/veiron-docker-overlay
git clone --depth 1 https://github.com/andreidohot/Veiron-Network-Main.git /opt/veiron-agent
curl -fsSL {bundle} -o /tmp/veiron-docker-stack.zip
mkdir -p /tmp/veiron-docker-overlay
unzip -q /tmp/veiron-docker-stack.zip -d /tmp/veiron-docker-overlay
cp -a /tmp/veiron-docker-overlay/Veiron-Network-Main/. /opt/veiron-agent/
cd /opt/veiron-agent/veiron-release/vps-control-plane
./scripts/enroll-docker-node.sh --node-name {node} --p2p-host {domain} --email {email} --controller-url {controller} --enrollment-token {token} --seed {seed} --release-bundle-url {bundle}
"#,bundle=shell_arg(&state.config.release_bundle_url),node=shell_arg(&request.node_name),domain=shell_arg(&request.advertise_host),email=shell_arg(&request.acme_email),controller=shell_arg(&controller),token=shell_arg(&invite.token),seed=shell_arg(&seed))
    } else {
        format!("set -euo pipefail\ncurl -fsSL {bundle} -o /tmp/veiron-vps-control-linux-x86_64.tar.gz\n",bundle=state.config.release_bundle_url)
    };
'''
 a=a[:start]+block+a[end:]
old='''            detail: format!(
                "Point A/AAAA for {} to the new VPS. Open TCP 80, 443 and {} (P2P).",
                request.advertise_host, state.config.p2p_port
            ),
'''
new='''            detail: if docker_mode() {
                format!("Point DNS for {} to the new host and open TCP {} for P2P.", request.advertise_host, state.config.p2p_port)
            } else {
                format!("Point A/AAAA for {} to the new VPS. Open TCP 80, 443 and {} (P2P).", request.advertise_host, state.config.p2p_port)
            },
'''
if 'Point DNS for' not in a: a=one(a,old,new,'firewall detail')
if 'let services = if docker_mode()' not in a:
 marker='    NodeReport {\n'; pos=a.index(marker,a.index('async fn collect_local_report'))
 services='''    let services = if docker_mode() { ServiceStates { node: json_service_state(&p2p), rpc: json_service_state(&status), indexer_timer: json_service_state(&indexer), admin: "active".to_owned() } } else { service_states() };
'''
 a=a[:pos]+services+a[pos:]
 report=a.index(marker,pos); sp=a.index('        services: service_states(),',report); a=a[:sp]+'        services,'+a[sp+len('        services: service_states(),'):]
if 'fn docker_mode() -> bool' not in a:
 helper='''fn docker_mode() -> bool { env::var("VEIRON_DEPLOYMENT_MODE").map(|v| v.eq_ignore_ascii_case("docker")).unwrap_or(false) }
fn json_service_state(payload: &Value) -> String { if payload.get("error").is_some() { "inactive".to_owned() } else { "active".to_owned() } }

'''
 a=one(a,'fn systemd_state(unit: &str) -> String {',helper+'fn systemd_state(unit: &str) -> String {','helpers')
APP.write_text(a)
print('Veiron Docker runtime/enrollment patch applied')
