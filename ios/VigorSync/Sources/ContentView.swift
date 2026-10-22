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
                    if engine.pendingSamples > 0 { LabeledContent("Pending", value: "\(engine.pendingSamples) changes") }
                    if !engine.lastResult.isEmpty { Text(engine.lastResult).font(.footnote) }
                    if let e = engine.lastError { Text(e).font(.footnote).foregroundStyle(.red) }
                    Text("Vigor Sync aims to sync about every hour. iOS decides the exact timing; syncs pause while the iPhone is locked or in Low Power Mode and catch up afterwards.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if !engine.progress.isEmpty { progressSection }
                Section {
                    Button("Re-send history (reset anchors)", role: .destructive) { settings.resetAnchors(); message = "Next sync re-sends the backfill window. Duplicates are skipped by Vigor." }
                }
                if !message.isEmpty { Section { Text(message).font(.footnote) } }
            }
            .navigationTitle("Vigor Sync")
        }
    }

    /// Live per-type progress of the running sync (or the result of the last one).
    private var progressSection: some View {
        let all = engine.progress
        let active = all.filter { $0.state == .reading || $0.state == .sending || $0.state == .failed || $0.sent > 0 }
        let upToDate = all.filter { $0.state == .done && $0.sent == 0 }.count
        let notReached = all.filter { $0.state == .pending }.count
        var footerParts: [String] = []
        if upToDate > 0 { footerParts.append("\(upToDate) types had nothing new") }
        if notReached > 0 { footerParts.append("\(notReached) not reached yet") }
        let footer = footerParts.joined(separator: " · ")
        return Section(engine.isSyncing ? "Sending" : "Last sync") {
            VStack(alignment: .leading, spacing: 6) {
                ProgressView(value: Double(engine.finishedScopes), total: Double(max(all.count, 1)))
                Text("\(engine.finishedScopes) of \(all.count) data types finished")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(active) { p in
                HStack(alignment: .top, spacing: 10) {
                    stateIcon(p.state).frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.label).font(.subheadline)
                        Text(detail(p)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !footer.isEmpty {
                Text(footer).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func stateIcon(_ state: ScopeProgress.State) -> some View {
        switch state {
        case .pending: Image(systemName: "circle").foregroundStyle(.secondary)
        case .reading, .sending: ProgressView()
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        }
    }

    private func detail(_ p: ScopeProgress) -> String {
        var parts: [String] = []
        switch p.state {
        case .reading: parts.append("reading from Health…")
        case .sending: parts.append("sending \(p.inFlight.formatted()) changes…")
        case .failed: parts.append("stopped here — next sync resumes")
        default: break
        }
        if p.sent > 0 {
            parts.append("\(p.sent.formatted()) sent in \(p.pages) page\(p.pages == 1 ? "" : "s")")
            parts.append("\(p.accepted.formatted()) new, \(p.skipped.formatted()) already stored")
            if p.updated > 0 { parts.append("\(p.updated.formatted()) updated") }
            if p.deleted > 0 { parts.append("\(p.deleted.formatted()) deleted") }
            if p.rejected > 0 { parts.append("\(p.rejected.formatted()) rejected") }
        }
        return parts.joined(separator: " · ")
    }
}
