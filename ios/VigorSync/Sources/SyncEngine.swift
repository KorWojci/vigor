import Foundation
import HealthKit

/// Incremental HealthKit → Vigor synchronisation.
///
/// For every data type an HKAnchoredObjectQuery returns the samples added and the objects deleted
/// since the stored anchor. They are sent to Vigor with the anchor as a cursor; the local anchor is
/// advanced only after Vigor answers 2xx. A failed or interrupted upload therefore leaves the
/// changes "queued": the next run re-reads exactly the same changes and Vigor deduplicates them by
/// HealthKit UUID. No separate on-device queue is needed.
@MainActor
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()
    static let source = "vigor-ios"
    static let pageSize = 5000

    let store = HKHealthStore()
    private let settings = SettingsStore.shared

    @Published private(set) var isSyncing = false
    @Published private(set) var lastSuccess: Date? = UserDefaults.standard.object(forKey: "lastSuccess") as? Date
    @Published private(set) var lastAttempt: Date? = UserDefaults.standard.object(forKey: "lastAttempt") as? Date
    @Published private(set) var lastError: String? = UserDefaults.standard.string(forKey: "lastError")
    @Published private(set) var lastResult: String = ""
    @Published private(set) var pendingSamples = 0
    /// Per-type progress of the current (or last) sync, in HealthTypes.allScopes order.
    @Published private(set) var progress: [ScopeProgress] = []
    /// The type being read or sent right now; nil when idle.
    @Published private(set) var currentScope: String?

    var finishedScopes: Int { progress.filter { $0.state == .done }.count }

    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    func requestAuthorization() async throws {
        try await store.requestAuthorization(toShare: [], read: HealthTypes.readTypes)
    }

    private func client() throws -> APIClient {
        guard let url = URL(string: settings.serverURL), url.host != nil, let token = settings.token else {
            throw APIClient.APIError(status: 0, message: "Server URL or token missing")
        }
        return APIClient(baseURL: url, token: token)
    }

    func testConnection() async -> String {
        do {
            let s = try await client().status(source: Self.source)
            return s.ok ? "Connected. Server sync target: every \(s.targetIntervalMinutes ?? 60) min." : "Unexpected reply"
        } catch {
            return "Failed: \(error.localizedDescription)"
        }
    }

    /// Runs one full incremental sync over all scopes. Safe to call concurrently (later calls no-op).
    @discardableResult
    func sync(reason: String) async -> Bool {
        guard !isSyncing else { return false }
        guard settings.isConfigured else { lastError = "Not configured"; return false }
        isSyncing = true
        defer { isSyncing = false }
        let started = Date()
        lastAttempt = started
        UserDefaults.standard.set(started, forKey: "lastAttempt")
        var totals = (accepted: 0, updated: 0, deleted: 0, rejected: 0)
        progress = HealthTypes.allScopes.map { ScopeProgress(scope: $0) }
        var active: Int?
        do {
            let api = try client()
            try await restoreAnchorsIfNeeded(api)
            for (i, scope) in HealthTypes.allScopes.enumerated() {
                guard let type = HealthTypes.sampleType(forScope: scope) else { progress[i].state = .done; continue }
                active = i
                currentScope = scope
                progress[i].state = .reading
                // Page through changes until HealthKit returns fewer than a full page.
                while true {
                    let (added, deleted, newAnchor) = try await changes(for: type, scope: scope)
                    if added.isEmpty && deleted.isEmpty {
                        if let a = newAnchor { settings.setAnchorData(archive(a), scope: scope) }
                        break
                    }
                    let pageCount = added.count + deleted.count
                    pendingSamples = pageCount
                    progress[i].state = .sending
                    progress[i].inFlight = pageCount
                    let payload = buildPayload(scope: scope, added: added, deleted: deleted, anchor: newAnchor)
                    let res = try await api.importPayload(payload)
                    totals.accepted += res.summary.accepted
                    totals.updated += res.summary.updated
                    totals.deleted += res.summary.deleted
                    totals.rejected += res.summary.rejected
                    progress[i].pages += 1
                    progress[i].sent += pageCount
                    progress[i].inFlight = 0
                    progress[i].accepted += res.summary.accepted
                    progress[i].updated += res.summary.updated
                    progress[i].skipped += res.summary.skipped
                    progress[i].deleted += res.summary.deleted
                    progress[i].rejected += res.summary.rejected
                    // Acknowledged — advance the cursor.
                    if let a = newAnchor { settings.setAnchorData(archive(a), scope: scope) }
                    pendingSamples = 0
                    if pageCount < Self.pageSize { break }
                    progress[i].state = .reading
                }
                progress[i].state = .done
            }
            active = nil
            currentScope = nil
            lastSuccess = Date()
            UserDefaults.standard.set(lastSuccess, forKey: "lastSuccess")
            lastError = nil
            UserDefaults.standard.removeObject(forKey: "lastError")
            lastResult = "\(totals.accepted) new, \(totals.updated) updated, \(totals.deleted) deleted, \(totals.rejected) rejected (\(reason))"
            await report()
            return true
        } catch {
            if let i = active {
                progress[i].state = .failed
                progress[i].inFlight = 0
            }
            currentScope = nil
            lastError = error.localizedDescription
            UserDefaults.standard.set(lastError, forKey: "lastError")
            await report()
            return false
        }
    }

    private func report() async {
        guard let api = try? client() else { return }
        await api.reportStatus([
            "source": Self.source,
            "pendingSamples": pendingSamples,
            "lastAttemptAt": lastAttempt.map { iso.string(from: $0) } ?? NSNull(),
            "lastSuccessAt": lastSuccess.map { iso.string(from: $0) } ?? NSNull(),
            "lastError": lastError ?? NSNull(),
        ])
    }

    /// After a reinstall, local anchors are gone; Vigor keeps the last acknowledged ones.
    private func restoreAnchorsIfNeeded(_ api: APIClient) async throws {
        guard HealthTypes.allScopes.allSatisfy({ settings.anchorData(scope: $0) == nil }) else { return }
        guard let remote = try? await api.status(source: Self.source) else { return }
        for c in remote.cursors {
            if let d = Data(base64Encoded: c.value), (try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: d)) != nil {
                settings.setAnchorData(d, scope: c.scope)
            }
        }
    }

    private func changes(for type: HKSampleType, scope: String) async throws -> ([HKSample], [HKDeletedObject], HKQueryAnchor?) {
        let anchorData = settings.anchorData(scope: scope)
        let anchor = anchorData.flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0) }
        // First run for a type: limit the historical backfill to the configured number of days.
        let predicate = anchor == nil
            ? HKQuery.predicateForSamples(withStart: Calendar.current.date(byAdding: .day, value: -settings.backfillDays, to: Date()), end: nil)
            : nil
        return try await withCheckedThrowingContinuation { cont in
            let q = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: anchor, limit: Self.pageSize) { _, added, deleted, newAnchor, error in
                if let error {
                    cont.resume(throwing: error)
                } else {
                    cont.resume(returning: (added ?? [], deleted ?? [], newAnchor))
                }
            }
            store.execute(q)
        }
    }

    private func archive(_ a: HKQueryAnchor) -> Data? {
        try? NSKeyedArchiver.archivedData(withRootObject: a, requiringSecureCoding: true)
    }

    private func buildPayload(scope: String, added: [HKSample], deleted: [HKDeletedObject], anchor: HKQueryAnchor?) -> [String: Any] {
        var samples: [[String: Any]] = []
        var workouts: [[String: Any]] = []
        for s in added {
            var base: [String: Any] = [
                "startAt": iso.string(from: s.startDate),
                "endAt": iso.string(from: s.endDate),
                "externalId": s.uuid.uuidString,
                "sourceName": s.sourceRevision.source.name,
                "sourceBundleId": s.sourceRevision.source.bundleIdentifier,
            ]
            if let d = s.device?.name { base["device"] = d }
            if let q = s as? HKQuantitySample, let m = HealthTypes.quantities.first(where: { $0.identifier.rawValue == q.quantityType.identifier }) {
                guard q.quantity.is(compatibleWith: m.unit) else { continue }
                base["type"] = m.key
                base["value"] = q.quantity.doubleValue(for: m.unit)
                base["unit"] = m.unitName
                samples.append(base)
            } else if let c = s as? HKCategorySample, c.categoryType == HealthTypes.sleep {
                guard let cat = HealthTypes.sleepCategory(c.value) else { continue }
                base["type"] = "sleep_analysis"
                base["category"] = cat
                samples.append(base)
            } else if let c = s as? HKCategorySample, c.categoryType == HealthTypes.standHour {
                guard c.value == HKCategoryValueAppleStandHour.stood.rawValue else { continue }
                base["type"] = "stand_hours"
                base["value"] = 1
                base["unit"] = "hr"
                samples.append(base)
            } else if let w = s as? HKWorkout {
                var item: [String: Any] = [
                    "externalId": w.uuid.uuidString,
                    "activityType": HealthTypes.activityName(w.workoutActivityType),
                    "startAt": iso.string(from: w.startDate),
                    "endAt": iso.string(from: w.endDate),
                    "durationSeconds": w.duration,
                    "sourceName": w.sourceRevision.source.name,
                ]
                if let e = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity() { item["energyKcal"] = e.doubleValue(for: .kilocalorie()) }
                if let d = w.totalDistance { item["distanceMeters"] = d.doubleValue(for: .meter()) }
                let bpm = HKUnit.count().unitDivided(by: .minute())
                if let hr = w.statistics(for: HKQuantityType(.heartRate)) {
                    if let a = hr.averageQuantity() { item["avgHeartRate"] = a.doubleValue(for: bpm) }
                    if let x = hr.maximumQuantity() { item["maxHeartRate"] = x.doubleValue(for: bpm) }
                }
                workouts.append(item)
            }
        }
        var payload: [String: Any] = [
            "schemaVersion": 1,
            "source": Self.source,
            "syncId": UUID().uuidString,
            "generatedAt": iso.string(from: Date()),
            "device": ["name": "iPhone", "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "", "timeZone": TimeZone.current.identifier],
            "samples": samples,
            "workouts": workouts,
            "deleted": deleted.map { ["externalId": $0.uuid.uuidString, "kind": scope == "workouts" ? "workout" : "sample"] },
        ]
        if let a = anchor, let d = archive(a) { payload["cursors"] = [["scope": scope, "value": d.base64EncodedString()]] }
        return payload
    }
}
