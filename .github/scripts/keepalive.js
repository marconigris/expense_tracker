const { chromium } = require("playwright");

const APP_URL = "https://chettiexpenses.streamlit.app/";
const WAKE_TEXT_PATTERN = /get this app back up|wake|back up/i;
const SLEEP_PAGE_PATTERN = /gone to sleep|inactive|get this app back up|wake this app/i;
const APP_READY_PATTERN = /username|password|please enter your username and password|cabarete|hymerlife|cash usd|coaching/i;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(APP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });

    const initialText = await page.locator("body").innerText().catch(() => "");
    const wakeButton = page.getByRole("button", { name: WAKE_TEXT_PATTERN }).first();

    if (SLEEP_PAGE_PATTERN.test(initialText) || await wakeButton.count()) {
      console.log("Sleep screen detected, attempting wake-up.");
      if (await wakeButton.count()) {
        await wakeButton.click();
      } else {
        throw new Error("Sleep screen detected, but no wake button was found.");
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 180_000 });
      await page.waitForTimeout(5000);
    }

    await page.waitForLoadState("networkidle", { timeout: 180_000 }).catch(() => {});

    const finalText = await page.locator("body").innerText().catch(() => "");
    console.log("Loaded URL:", page.url());
    console.log("Page title:", await page.title());

    if (SLEEP_PAGE_PATTERN.test(finalText)) {
      await page.screenshot({ path: "keepalive-failed.png", fullPage: true });
      throw new Error("App still appears to be asleep after wake attempt.");
    }

    if (!APP_READY_PATTERN.test(finalText)) {
      await page.screenshot({ path: "keepalive-failed.png", fullPage: true });
      throw new Error("App did not reach a recognizable ready state.");
    }

    console.log("App reached a recognizable ready state.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
