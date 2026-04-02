const { chromium } = require("playwright");

const APP_URL = "https://chettiexpenses.streamlit.app/";
const WAKE_TEXT = "Yes, get this app back up!";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(APP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });

    const wakeButton = page.getByText(WAKE_TEXT, { exact: true });
    if (await wakeButton.count()) {
      await wakeButton.first().click();
      await page.waitForLoadState("domcontentloaded", { timeout: 120_000 });
    }

    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
    console.log("Loaded URL:", page.url());
    console.log("Page title:", await page.title());
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
