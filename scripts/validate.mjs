import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const required = ["index.html", "styles.css", "app.js", "config.js", "apps-script/Code.gs", ".nojekyll"];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error("Missing required files:", missing.join(", "));
  process.exit(1);
}
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const ref of ["styles.css", "config.js", "app.js"]) {
  if (!html.includes(ref)) {
    console.error("index.html does not reference", ref);
    process.exit(1);
  }
}
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
if (!js.includes("0.7") || !js.includes("0.15")) {
  console.error("Payout split constants are missing.");
  process.exit(1);
}
const backend = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
if (!js.includes("TRIMMINGS_PER_BOX = 15") || !backend.includes("TRIMMINGS_PER_BOX = 15")) {
  console.error("The 15-trimmings-per-box conversion is missing.");
  process.exit(1);
}
if (!html.includes('name="trimmings"') || !html.includes("data-admin-dialog") || !backend.includes("assertAdmin_")) {
  console.error("Trimmings intake or manager authorization controls are missing.");
  process.exit(1);
}
if (!js.includes("data-unlock-payouts") || !backend.includes('["verifyAdmin", "settleSale"')) {
  console.error("Payout settlement is not protected by manager authorization.");
  process.exit(1);
}
console.log("Tracker static validation passed.");
