import { cookies } from "next/headers";
import { LANG_COOKIE, isLang, messages, type Lang } from "./messages";

// The language picked with the flags, kept in a cookie on the device. English by default.
export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "en";
}

export async function getMessages() {
  const lang = await getLang();
  return { lang, t: messages(lang) };
}
