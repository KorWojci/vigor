import Foundation

/// Status of one data type (cursor scope), shown as a static row in ContentView: a result icon
/// on the right and the last time it synced successfully. No live counts — the list is meant to
/// stay still; only the icon and timestamp of the row currently being handled change.
struct ScopeStatus: Identifiable, Equatable {
    enum State: Equatable {
        case neverSynced  // no successful sync yet, and nothing in progress
        case syncing       // this type is being read/sent right now
        case ok            // most recent attempt succeeded
        case failed        // most recent attempt failed; lastSyncAt (if any) is from an earlier success
    }

    let scope: String
    var state: State = .neverSynced
    /// The last time this type synced successfully (nil if it never has).
    var lastSyncAt: Date?

    var id: String { scope }

    /// "heart_rate_variability" → "Heart rate variability".
    var label: String {
        let words = scope.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}
