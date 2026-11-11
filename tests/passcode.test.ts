import { describe, expect, it } from "vitest";
import { passcodeMatches } from "@/lib/auth/passcode";

describe("family passcode", () => {
  it("accepts the passcode, ignoring capitals and spaces", () => {
    expect(passcodeMatches("secret", "Secret")).toBe(true);
    expect(passcodeMatches("  SECRET ", "Secret")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(passcodeMatches("secre", "Secret")).toBe(false);
    expect(passcodeMatches("", "Secret")).toBe(false);
    expect(passcodeMatches("anything", "")).toBe(false);
  });
});
