import Foundation

/// Minimal client for Vigor's import API (docs/import-api.md).
struct APIClient {
    let baseURL: URL
    let token: String

    struct ImportSummary: Decodable {
        let received, accepted, updated, skipped, rejected, deleted: Int
    }
    struct ImportResponse: Decodable {
        let ok: Bool
        let summary: ImportSummary
    }
    struct Cursor: Decodable { let scope: String; let value: String }
    struct StatusResponse: Decodable {
        let ok: Bool
        let targetIntervalMinutes: Int?
        let cursors: [Cursor]
    }
    struct APIError: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { "HTTP \(status): \(message)" }
    }

    private func request(_ path: String, method: String, body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: baseURL.appendingPathComponent(path))
        r.httpMethod = method
        r.timeoutInterval = 60
        // The token is sent only in the Authorization header — never in the URL.
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = body
        }
        return r
    }

    private func send(_ r: URLRequest) async throws -> Data {
        let (data, resp) = try await URLSession.shared.data(for: r)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(status: status, message: msg ?? String(data: data, encoding: .utf8) ?? "unknown error")
        }
        return data
    }

    func importPayload(_ payload: [String: Any]) async throws -> ImportResponse {
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode(ImportResponse.self, from: try await send(request("api/v1/health/import", method: "POST", body: body)))
    }

    func status(source: String) async throws -> StatusResponse {
        var r = request("api/v1/health/status", method: "GET")
        var c = URLComponents(url: r.url!, resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "source", value: source)]
        r.url = c.url
        return try JSONDecoder().decode(StatusResponse.self, from: try await send(r))
    }

    func reportStatus(_ report: [String: Any]) async {
        guard let body = try? JSONSerialization.data(withJSONObject: report) else { return }
        _ = try? await send(request("api/v1/health/status", method: "POST", body: body))
    }
}
