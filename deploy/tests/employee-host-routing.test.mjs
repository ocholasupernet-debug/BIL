import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const nginx = read("../nginx.conf");
const hostSpecificNginx = read("../nginx-host-specific.conf");
const employeeNginx = read("../nginx-employee-com.conf");
const configureNginx = read("../configure-nginx.sh");

test("HTTP challenge/redirect vhosts recognize both employee .com host patterns", () => {
  for (const source of [nginx, hostSpecificNginx]) {
    assert.match(source, /employee1088\.isplatty\.com/);
    assert.match(source, /\*\.employees\.isplatty\.com/);
    assert.match(source, /employee-sites\.d\/\*\.conf/);
  }
});

test("employee HTTPS routing preserves Host and uses the dedicated shared BIL upstream", () => {
  assert.match(employeeNginx, /server_name employee1088\.isplatty\.com \*\.employees\.isplatty\.com/);
  assert.match(employeeNginx, /proxy_pass\s+http:\/\/127\.0\.0\.1:8080/);
  assert.match(employeeNginx, /proxy_set_header\s+Host\s+\$http_host/);
  assert.match(employeeNginx, /proxy_set_header\s+X-Forwarded-Host\s+\$http_host/);
  assert.match(employeeNginx, /isplatty-com-employee-origin\/fullchain\.pem/);
  assert.match(employeeNginx, /isplatty-com-employee-origin\/privkey\.pem/);
});

test("Nginx setup enables the employee vhost only for a matching SAN certificate and key", () => {
  assert.match(configureNginx, /DNS:employee1088\.\$\{COM_DOMAIN\}/);
  assert.match(configureNginx, /DNS:\*\.employees\.\$\{COM_DOMAIN\}/);
  assert.match(configureNginx, /certificate_public_key.*openssl x509/s);
  assert.match(configureNginx, /private_key_public_key.*openssl pkey/s);
  assert.match(configureNginx, /if has_com_employee_origin_certificate; then[\s\S]*?install -m 0644 "\$\{PROJECT_DIR\}\/deploy\/nginx-employee-com\.conf"/);
});
