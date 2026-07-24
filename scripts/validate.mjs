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
if (!html.includes('id="managerPayoutQueue"') || html.includes('id="payoutQueue"') || !html.includes('data-select-all-payouts') || !html.includes('data-action="settle-selected"') || !js.includes('#managerPayoutQueue') || !js.includes('if (!state.adminCode) return ""') || !js.includes('selectedPayouts') || !js.includes('mutate("settlePayouts"') || !backend.includes('"settleSale"') || !backend.includes('"settlePayouts"') || !backend.includes('settlePayouts_') || !backend.includes('withLock_') || !backend.includes("assertAdmin_(body.adminCode)")) {
  console.error("Payout settlement is not protected by manager authorization.");
  process.exit(1);
}
if (!html.includes('id="correctionForm"') || !html.includes('id="managerGrowRecords"') || !html.includes('id="managerSaleRecords"') || !js.includes('mutate("updateGrow"') || !js.includes('mutate("updateSale"') || !js.includes('mutate("deleteGrow"') || !js.includes('mutate("deleteSale"') || !js.includes('mutate("reopenPayout"') || !backend.includes('corrections: "Web_Corrections"') || !backend.includes("deleteGrow_") || !backend.includes("deleteSale_") || !backend.includes("reopenPayout_") || !backend.includes("readActiveObjects_") || !backend.includes("logCorrection_") || !backend.includes("assertInventoryValid_")) {
  console.error("Manager correction controls, audit history, or inventory safeguards are missing.");
  process.exit(1);
}
if (!html.includes('id="supplyForm"') || !js.includes('mutate("addSupply"') || !backend.includes('supplies: "Web_Supplies"') || !backend.includes("outstandingSupplies_")) {
  console.error("Supply purchase tracking or gang-share recovery is missing.");
  process.exit(1);
}
console.log("Tracker static validation passed.");
