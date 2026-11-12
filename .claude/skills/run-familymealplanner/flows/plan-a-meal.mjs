// Example flow: tap the first suggested meal, tap Monday lunch, check the slot filled.
//   node .claude/skills/run-familymealplanner/driver.mjs run .claude/skills/run-familymealplanner/flows/plan-a-meal.mjs
export default async function ({ page, APP, shot, audit }) {
  await page.goto(`${APP}/week`, { waitUntil: "networkidle" });
  const slot = page.getByRole("button", { name: /^Mon Lunch:/ });
  console.log("before:", await slot.getAttribute("aria-label"));

  const suggestion = page.locator("aside, section").filter({ hasText: "Suggested meals" }).locator("button").first();
  const meal = (await suggestion.innerText()).split("\n")[0];
  await suggestion.click();
  await slot.click();
  await page.waitForFunction(
    (m) => [...document.querySelectorAll("[aria-label^='Mon Lunch:']")].some((el) => el.getAttribute("aria-label").includes(m)),
    meal,
    { timeout: 10000 },
  );
  console.log("picked:", meal);
  console.log("after: ", await slot.getAttribute("aria-label"));
  // the board updates optimistically; reload to prove the server action saved it
  await page.waitForLoadState("networkidle");
  await page.reload({ waitUntil: "networkidle" });
  console.log("after reload:", await slot.getAttribute("aria-label"));
  console.log("screenshot:", await shot("plan-a-meal"));
  console.log("audit:", JSON.stringify(await audit()));
}
