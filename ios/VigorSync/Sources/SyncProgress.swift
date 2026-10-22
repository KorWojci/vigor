import Foundation

/// Live progress of one data type (cursor scope) during a sync, shown in ContentView.
///
/// HealthKit has no cheap way to count the samples an anchored query will return, so there is no
/// per-type total to show a percentage against. A type reports what it has sent so far (samples
/// and deletions, in pages of up to `SyncEngine.pageSize`) and is finished when HealthKit returns
/// less than a full page. Overall progress is measured in finished types.
struct ScopeProgress: Identifiable, Equatable {
    enum State: Equatable {
        case pending   // not reached yet in this run
        case reading   // querying HealthKit for the next page
        case sending   // a page is being uploaded to Vigor
        case done      // all changes sent and acknowledged
        case failed    // the run stopped here; the next sync resumes from the last acknowledged page
    }

    let scope: String
    var state: State = .pending
    var pages = 0
    /// Samples and deletions acknowledged by Vigor so far.
    var sent = 0
    /// Size of the page currently being uploaded (0 when nothing is in flight).
    var inFlight = 0
    var accepted = 0
    var updated = 0
    var skipped = 0
    var deleted = 0
    var rejected = 0

    var id: String { scope }

    /// "heart_rate_variability" → "Heart rate variability".
    var label: String {
        let words = scope.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}
