import { describe, expect, it } from "vitest";
import { authenticate, createSession, createUser, getSessionUser, deleteSession, changePassword } from "@/lib/auth/users";
import { createApiToken, revokeApiToken, rotateApiToken, verifyBearer } from "@/lib/auth/api-tokens";
import { getSetting, setSetting } from "@/lib/settings";
import { deleteData, storageStats } from "@/lib/data/manage";
import { addMeasurement, createCustomMeasurementType, listMeasurementTypes } from "@/lib/body/repo";
import { getSyncStatus, recordClientStatus } from "@/lib/ingest/sync-status";
import { doImport, envelope, testDb } from "./helpers";

describe("users and sessions", () => {
  it("authenticates and manages sessions", () => {
    const db = testDb();
    const u = createUser(db, "admin", "synthetic-password-123");
    expect(authenticate(db, "admin", "wrong-password-xx")).toBeNull();
    expect(authenticate(db, "admin", "synthetic-password-123")?.id).toBe(u.id);
    const { token } = createSession(db, u.id);
    expect(getSessionUser(db, token)?.username).toBe("admin");
    deleteSession(db, token);
    expect(getSessionUser(db, token)).toBeNull();
  });
  it("rejects short passwords and invalidates sessions on change", () => {
    const db = testDb();
    expect(() => createUser(db, "admin", "short")).toThrow();
    const u = createUser(db, "admin", "synthetic-password-123");
    const { token } = createSession(db, u.id);
    changePassword(db, u.id, "synthetic-password-123", "another-synthetic-456");
    expect(getSessionUser(db, token)).toBeNull();
  });
});

describe("ingestion tokens", () => {
  it("stores only hashes and supports revoke/rotate", () => {
    const db = testDb();
    const { token, info } = createApiToken(db, "Test phone");
    const stored = db.prepare("SELECT token_hash FROM api_tokens").get() as { token_hash: string };
    expect(stored.token_hash).not.toContain(token);
    expect(verifyBearer(db, `Bearer ${token}`)?.tokenId).toBe(info.id);
    expect(verifyBearer(db, `Basic ${token}`)).toBeNull();
    expect(verifyBearer(db, null)).toBeNull();
    const rotated = rotateApiToken(db, info.id)!;
    expect(verifyBearer(db, `Bearer ${token}`)).toBeNull();
    expect(verifyBearer(db, `Bearer ${rotated.token}`)).not.toBeNull();
    revokeApiToken(db, rotated.info.id);
    expect(verifyBearer(db, `Bearer ${rotated.token}`)).toBeNull();
  });
});

describe("settings", () => {
  it("returns defaults and validates values", () => {
    const db = testDb();
    expect(getSetting(db, "units")).toBe("metric");
    setSetting(db, "units", "imperial");
    expect(getSetting(db, "units")).toBe("imperial");
    expect(() => setSetting(db, "timezone", "Mars/Olympus")).toThrow();
  });
});

describe("body measurements", () => {
  it("supports custom types and validates entries", () => {
    const db = testDb();
    const t = createCustomMeasurementType(db, "Wrist", "length", null);
    expect(listMeasurementTypes(db).some((x) => x.key === t.key)).toBe(true);
    expect(() => addMeasurement(db, t.key, -1, Date.now(), null)).toThrow();
    expect(() => addMeasurement(db, "body_fat", 120, Date.now(), null)).toThrow();
    addMeasurement(db, t.key, 17, Date.now() - 1000, "synthetic");
    addMeasurement(db, t.key, 17.2, Date.now(), null);
    expect(storageStats(db).counts["Body measurements"]).toBe(2);
  });
});

describe("sync status and data deletion", () => {
  it("reports never / ok / stale states", () => {
    const db = testDb();
    expect(getSyncStatus(db).state).toBe("never");
    const now = Date.parse("2026-10-20T09:00:00Z");
    doImport(db, envelope({ samples: [{ type: "step_count", value: 1, unit: "count", startAt: "2026-10-20T07:00:00Z" }] }), now);
    expect(getSyncStatus(db, Date.now()).state).toBe("ok");
    expect(getSyncStatus(db, Date.now() + 10 * 3600_000, 3).state).toBe("stale");
    recordClientStatus(db, { source: "vigor-ios", pendingSamples: 12, lastError: "offline" });
    expect(getSyncStatus(db).clients[0].pendingSamples).toBe(12);
  });
  it("deletes data by scope", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [{ type: "step_count", value: 1, unit: "count", startAt: "2026-10-20T07:00:00Z" }] }));
    addMeasurement(db, "waist", 80, Date.now(), null);
    deleteData(db, "health");
    const s = storageStats(db).counts;
    expect(s["Health samples"]).toBe(0);
    expect(s["Body measurements"]).toBe(1);
  });
});
