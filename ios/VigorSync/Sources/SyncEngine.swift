import CoreLocation
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
    /// One static row per data type, in HealthTypes.allScopes order — always populated, even
    /// before the first sync of this session, from the status the last sync of each type left
    /// persisted in SettingsStore.
    @Published private(set) var progress: [ScopeStatus]

    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init() {
        let s = SettingsStore.shared
        progress = HealthTypes.allScopes.map { scope in
            let lastSyncAt = s.scopeLastSyncAt(scope)
            var row = ScopeStatus(scope: scope)
            row.lastSyncAt = lastSyncAt
            row.state = s.scopeFailed(scope) ? .failed : (lastSyncAt != nil ? .ok : .neverSynced)
            return row
        }
    }

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
        var active: Int?
        do {
            let api = try client()
            if settings.pendingFullResync {
                // Honour the explicit reset: don't let restoreAnchorsIfNeeded pull the server's
                // old cursors straight back before this run even gets to read anything.
                settings.pendingFullResync = false
            } else {
                try await restoreAnchorsIfNeeded(api)
            }
            for (i, scope) in HealthTypes.allScopes.enumerated() {
                guard let type = HealthTypes.sampleType(forScope: scope) else { continue }
                active = i
                progress[i].state = .syncing
                // Page through changes until HealthKit returns fewer than a full page.
                while true {
                    let (added, deleted, newAnchor) = try await changes(for: type, scope: scope)
                    if added.isEmpty && deleted.isEmpty {
                        if let a = newAnchor { settings.setAnchorData(archive(a), scope: scope) }
                        break
                    }
                    let pageCount = added.count + deleted.count
                    pendingSamples = pageCount
                    let payload = await buildPayload(scope: scope, added: added, deleted: deleted, anchor: newAnchor)
                    let res = try await api.importPayload(payload)
                    totals.accepted += res.summary.accepted
                    totals.updated += res.summary.updated
                    totals.deleted += res.summary.deleted
                    totals.rejected += res.summary.rejected
                    // Acknowledged — advance the cursor.
                    if let a = newAnchor { settings.setAnchorData(archive(a), scope: scope) }
                    pendingSamples = 0
                    if pageCount < Self.pageSize { break }
                }
                let now = Date()
                progress[i].state = .ok
                progress[i].lastSyncAt = now
                settings.setScopeLastSyncAt(now, scope: scope)
                settings.setScopeFailed(false, scope: scope)
            }
            active = nil
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
                settings.setScopeFailed(true, scope: progress[i].scope)
            }
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

    /// The HKWorkoutRoute object(s) HealthKit attached to a workout (usually zero or one).
    private func workoutRoutes(for workout: HKWorkout) async throws -> [HKWorkoutRoute] {
        try await withCheckedThrowingContinuation { cont in
            let predicate = HKQuery.predicateForObjects(from: workout)
            let q = HKSampleQuery(sampleType: HKSeriesType.workoutRoute(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error {
                    cont.resume(throwing: error)
                } else {
                    cont.resume(returning: (samples as? [HKWorkoutRoute]) ?? [])
                }
            }
            store.execute(q)
        }
    }

    /// All the location points of one route. HKWorkoutRouteQuery delivers them in batches, ending
    /// with one call where `done` is true — the continuation resumes only on that final call.
    private func routeLocations(in route: HKWorkoutRoute) async throws -> [CLLocation] {
        try await withCheckedThrowingContinuation { cont in
            var all: [CLLocation] = []
            let q = HKWorkoutRouteQuery(route: route) { _, batch, done, error in
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                if let batch { all.append(contentsOf: batch) }
                if done { cont.resume(returning: all) }
            }
            store.execute(q)
        }
    }

    /// Route points for one workout, thinned to roughly one point every 8s or 15m (whichever
    /// comes first) so a long run stays a reasonable payload size; always keeps the first and
    /// last point. `t` is seconds since the workout's start, matching how the cardio detail page
    /// already times heart-rate and split data relative to a workout's start.
    private func decimatedRoute(for workout: HKWorkout) async -> [[String: Any]] {
        guard let hkRoutes = try? await workoutRoutes(for: workout), !hkRoutes.isEmpty else { return [] }
        var locations: [CLLocation] = []
        for route in hkRoutes {
            if let batch = try? await routeLocations(in: route) { locations.append(contentsOf: batch) }
        }
        guard let first = locations.first else { return [] }
        locations.sort { $0.timestamp < $1.timestamp }

        let minIntervalS: TimeInterval = 8
        let minDistanceM: CLLocationDistance = 15
        var kept: [CLLocation] = [first]
        for loc in locations {
            guard let last = kept.last else { continue }
            if loc.timestamp.timeIntervalSince(last.timestamp) >= minIntervalS || loc.distance(from: last) >= minDistanceM {
                kept.append(loc)
            }
        }
        if let last = locations.last, kept.last?.timestamp != last.timestamp { kept.append(last) }

        // An unusually long event (e.g. an ultra) could still exceed the server's point limit even
        // after thinning — subsample evenly rather than truncate, so the whole route still shows.
        let maxPoints = 2000
        if kept.count > maxPoints {
            let stride = Double(kept.count) / Double(maxPoints)
            var sampled: [CLLocation] = []
            var i = 0.0
            while Int(i) < kept.count {
                sampled.append(kept[Int(i)])
                i += stride
            }
            kept = sampled
        }

        let start = workout.startDate
        return kept.map { loc -> [String: Any] in
            var point: [String: Any] = [
                "t": loc.timestamp.timeIntervalSince(start),
                "lat": (loc.coordinate.latitude * 100_000).rounded() / 100_000,
                "lon": (loc.coordinate.longitude * 100_000).rounded() / 100_000,
            ]
            if loc.verticalAccuracy >= 0 { point["ele"] = (loc.altitude * 10).rounded() / 10 }
            return point
        }
    }

    private func buildPayload(scope: String, added: [HKSample], deleted: [HKDeletedObject], anchor: HKQueryAnchor?) async -> [String: Any] {
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
                let route = await decimatedRoute(for: w)
                if !route.isEmpty { item["route"] = route }
                // Weather Apple Watch already attached on-device for an outdoor workout — not fetched by this app.
                if let meta = w.metadata {
                    var weather: [String: Any] = [:]
                    if let q = meta[HKMetadataKeyWeatherTemperature] as? HKQuantity, q.is(compatibleWith: .degreeCelsius()) {
                        weather["tempC"] = q.doubleValue(for: .degreeCelsius())
                    }
                    if let q = meta[HKMetadataKeyWeatherHumidity] as? HKQuantity, q.is(compatibleWith: .percent()) {
                        weather["humidityPct"] = q.doubleValue(for: .percent()) * 100
                    }
                    if let c = meta[HKMetadataKeyWeatherCondition] as? NSNumber {
                        weather["conditionCode"] = c.intValue
                    }
                    if !weather.isEmpty { item["weather"] = weather }
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
