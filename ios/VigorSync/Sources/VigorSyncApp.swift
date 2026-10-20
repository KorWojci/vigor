import SwiftUI

@main
struct VigorSyncApp: App {
    @Environment(\.scenePhase) private var phase

    init() {
        BackgroundSync.register()
        BackgroundSync.scheduleRefresh()
        if SettingsStore.shared.isConfigured {
            Task { @MainActor in BackgroundSync.startObserving() }
        }
    }

    var body: some Scene {
        WindowGroup { ContentView() }
            .onChange(of: phase) { _, newPhase in
                if newPhase == .active, SettingsStore.shared.isConfigured {
                    Task { await SyncEngine.shared.sync(reason: "app opened") }
                }
                if newPhase == .background { BackgroundSync.scheduleRefresh() }
            }
    }
}
