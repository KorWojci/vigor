import Foundation
import Security

/// Server URL and preferences live in UserDefaults; the ingestion token lives in the Keychain.
final class SettingsStore: ObservableObject {
    static let shared = SettingsStore()
    private let defaults = UserDefaults.standard

    @Published var serverURL: String { didSet { defaults.set(serverURL, forKey: "serverURL") } }
    @Published var backfillDays: Int { didSet { defaults.set(backfillDays, forKey: "backfillDays") } }

    init() {
        serverURL = defaults.string(forKey: "serverURL") ?? ""
        let days = defaults.integer(forKey: "backfillDays")
        backfillDays = days > 0 ? days : 30
    }

    var token: String? {
        get { Keychain.read(account: "ingestToken") }
        set {
            if let v = newValue, !v.isEmpty { Keychain.write(account: "ingestToken", value: v) } else { Keychain.delete(account: "ingestToken") }
            objectWillChange.send()
        }
    }

    var isConfigured: Bool { URL(string: serverURL)?.host != nil && token != nil }

    // MARK: anchors (the incremental cursors) — advanced only after the server confirms receipt

    func anchorData(scope: String) -> Data? { defaults.data(forKey: "anchor.\(scope)") }
    func setAnchorData(_ data: Data?, scope: String) { defaults.set(data, forKey: "anchor.\(scope)") }
    func resetAnchors() { for s in HealthTypes.allScopes { defaults.removeObject(forKey: "anchor.\(s)") } }

    // MARK: per-type sync status — the static per-row result shown in ContentView

    /// The last time this type synced successfully, across all past runs, or nil if never.
    func scopeLastSyncAt(_ scope: String) -> Date? {
        let t = defaults.double(forKey: "scopeLastSyncAt.\(scope)")
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }
    func setScopeLastSyncAt(_ date: Date, scope: String) { defaults.set(date.timeIntervalSince1970, forKey: "scopeLastSyncAt.\(scope)") }

    /// Whether this type's most recent attempt failed (even if it had succeeded at some earlier point).
    func scopeFailed(_ scope: String) -> Bool { defaults.bool(forKey: "scopeFailed.\(scope)") }
    func setScopeFailed(_ failed: Bool, scope: String) { defaults.set(failed, forKey: "scopeFailed.\(scope)") }
}

enum Keychain {
    private static let service = "com.korwojci.vigor"

    static func write(account: String, value: String) {
        delete(account: account)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            // Readable in the background after the first unlock (needed for background sync).
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func read(account: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func delete(account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}
