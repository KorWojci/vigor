import BackgroundTasks
import HealthKit

/// Background scheduling. Two complementary mechanisms, both governed by iOS:
///  1. HealthKit background delivery (frequency .hourly): iOS wakes the app when new samples of an
///     observed type are saved, at most about once per hour per type.
///  2. A BGAppRefreshTask requested every hour as a fallback.
/// Neither guarantees an exact schedule: iOS considers battery, usage patterns, Low Power Mode and
/// whether the device is locked (protected Health data cannot be read while locked).
enum BackgroundSync {
    static let refreshTaskId = "local.vigor.sync.refresh"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskId, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            scheduleRefresh()
            let work = Task { @MainActor in
                let ok = await SyncEngine.shared.sync(reason: "background refresh")
                task.setTaskCompleted(success: ok)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func scheduleRefresh() {
        let req = BGAppRefreshTaskRequest(identifier: refreshTaskId)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }

    /// Call once per launch after Health authorisation. Observer queries must be re-created on every launch.
    @MainActor
    static func startObserving() {
        let store = SyncEngine.shared.store
        var types: [HKSampleType] = HealthTypes.quantities.map(\.type)
        types.append(contentsOf: [HealthTypes.sleep, HealthTypes.standHour, HealthTypes.workout])
        for type in types {
            store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
            let q = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                guard error == nil else { completion(); return }
                Task { @MainActor in
                    await SyncEngine.shared.sync(reason: "health update")
                    completion() // must always be called, or iOS stops delivering updates
                }
            }
            store.execute(q)
        }
    }
}
