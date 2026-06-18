import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packagePath = path.join(__dirname, "..", "package.json");

const packageJson = JSON.parse(
  fs.readFileSync(packagePath, "utf8")
);

export const VERSION = packageJson.version;

export const CODENAME = "Liverpool";

export const RELEASE = {
  codename: CODENAME,
  city: "Liverpool",
  country: "United Kingdom"
};

export function getVersionString() {
  return `v${VERSION} "${CODENAME}"`;
}
