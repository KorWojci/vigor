import SwiftUI

struct ContentView: View {
    @ObservedObject private var settings = SettingsStore.shared
    @ObservedObject private var engine = SyncEngine.shared
    @State private var tokenInput = ""
    @State private var message = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Vigor server") {
                    TextField("http://192.168.1.20:3000", text: $settings.serverURL)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField(settings.token == nil ? "Ingestion token (vgr_…)" : "Token saved — paste to replace", text: $tokenInput)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Save token") { settings.token = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines); tokenInput = "" }
                        .disabled(tokenInput.isEmpty)
                    Button("Test connection") { Task { message = await engine.testConnection() } }
                }
                Section("Health access") {
                    Button("Grant Health access") {
                        Task {
                            do {
                                try await engine.requestAuthorization()
                                BackgroundSync.startObserving()
                                message = "Health access requested. Check Settings → Health → Data Access if types are missing."
                            } catch { message = error.localizedDescription }
                        }
                    }
                    Stepper("Initial backfill: \(settings.backfillDays) days", value: $settings.backfillDays, in: 1...3650, step: 30)
                }
                Section("Synchronisation") {
                    Button(engine.isSyncing ? "Syncing…" : "Sync now") { Task { await engine.sync(reason: "manual") } }
                        .disabled(engine.isSyncing || !settings.isConfigured)
                    LabeledContent("Last success", value: engine.lastSuccess?.formatted(date: .abbreviated, time: .shortened) ?? "never")
                    LabeledContent("Last attempt", value: engine.lastAttempt?.formatted(date: .abbreviated, time: .shortened) ?? "never")
                    if !engine.lastResult.isEmpty { Text(engine.lastResult).font(.footnote) }
                    if let e = engine.lastError { Text(e).font(.footnote).foregroundStyle(.red) }
                    Text("Vigor Sync aims to sync about every hour. iOS decides the exact timing; syncs pause while the iPhone is locked or in Low Power Mode and catch up afterwards.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                progressSection
                Section {
                    Button("Re-send history (reset anchors)", role: .destructive) { settings.resetAnchors(); message = "Next sync re-sends the backfill window. Duplicates are skipped by Vigor." }
                }
                if !message.isEmpty { Section { Text(message).font(.footnote) } }
            }
            .navigationTitle("Vigor Sync")
        }
    }

    /// One static row per data type: a result icon and the last successful sync time, on the
    /// right. The list itself never changes shape — only the icon/time of the row currently
    /// being handled update as a sync runs.
    private var progressSection: some View {
        Section("Data types") {
            ForEach(engine.progress) { row in
                HStack {
                    Text(row.label)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        stateIcon(row.state)
                        Text(lastSyncText(row.lastSyncAt))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func stateIcon(_ state: ScopeStatus.State) -> some View {
        switch state {
        case .neverSynced: Image(systemName: "minus.circle").foregroundStyle(.secondary)
        case .syncing: ProgressView()
        case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        }
    }

    private func lastSyncText(_ date: Date?) -> String {
        guard let date else { return "Never" }
        return date.formatted(.relative(presentation: .named))
    }
}
