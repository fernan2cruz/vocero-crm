import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

// Compose se sustituye por una función de shell: estas pruebas no usan Docker.
const shell = `
sleep() { return 0; }
docker() {
  tag=$(sed -n 's/^IMAGE_TAG=//p' .env)
  printf '%s %s\\n' "$tag" "$*" >> compose.log
  case "$*" in
    *"ps --status"*) return 0 ;;
    *"build app backup"*) [ "$FALLO" != build ]; return $? ;;
    *"pull app"*) [ "$FALLO" != pull ]; return $? ;;
    *"up -d"*) if [ "$tag" = v2 ] && [ "$FALLO" = up ]; then return 1; fi ;;
    *"exec -T app wget"*) if [ "$tag" = v2 ] && [ "$FALLO" = health ]; then return 1; fi ;;
  esac
  return 0
}
. ./scripts/deploy.sh "$@"
`;

// `deploy.sh` es POSIX (AlmaLinux). En Windows no hay `sh`: se omite en vez de
// fallar por el entorno. El CI corre en Linux y ejecuta las seis ramas.
const sinShellPosix = spawnSync("sh", ["-c", "exit 0"]).status !== 0;
const prueba = sinShellPosix ? it.skip : it;

prueba.each(["pull", "up", "health", "build", "ninguno", "rollback"])("despliegue: rama %s", (fallo) => {
  const dir = mkdtempSync(join(tmpdir(), "wassapi-deploy-"));
  try {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "deploy.sh"), readFileSync("deploy/scripts/deploy.sh"));
    writeFileSync(join(dir, ".env"), "WASSAPI_IMAGE=crm\nIMAGE_TAG=v1\n");
    writeFileSync(join(dir, ".deployed_tag"), "v1\n");
    writeFileSync(join(dir, ".previous_tag"), "v0\n");
    const args = fallo === "rollback" ? ["--rollback"] : fallo === "build" ? ["--build", "v2"] : ["v2"];
    const result = spawnSync("sh", ["-c", shell, "./scripts/deploy.sh", ...args], {
      cwd: dir, encoding: "utf8", env: { ...process.env, FALLO: fallo, HEALTH_TIMEOUT: fallo === "health" ? "1" : "30" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(["ninguno", "rollback"].includes(fallo) ? 0 : 1);
    const env = readFileSync(join(dir, ".env"), "utf8");
    const log = readFileSync(join(dir, "compose.log"), "utf8");
    if (fallo === "ninguno") {
      expect(env).toContain("IMAGE_TAG=v2");
      expect(readFileSync(join(dir, ".previous_tag"), "utf8").trim()).toBe("v1");
    } else if (fallo === "rollback") {
      expect(env).toContain("IMAGE_TAG=v0");
      expect(log).not.toMatch(/pull app|build app backup/);
      expect(log).toContain("up -d --no-build");
    } else {
      expect(env).toContain("IMAGE_TAG=v1");
      if (fallo === "build") expect(log).not.toContain("up -d");
      else expect(log).toContain("v1 compose -f docker-compose.prod.yml up -d --no-build");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
