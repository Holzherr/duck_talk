import Foundation
import Network

/// How to reach the relay: the address, and the one-shot question.
///
/// The address is typed by hand, so "not an address" is an ordinary state and has to
/// arrive as a message on the screen. It could not: `URLSession.webSocketTask(with:)`
/// raises an Objective-C exception on any scheme but `ws`/`wss`, which Swift cannot
/// catch, so a saved `https://` address killed the app on launch — the home screen opens
/// its data socket in a `task`, which runs before there is a screen to say anything on.
/// `URL(string:)` is no guard at all: it parses `https://`, a bare hostname and `mailto:`
/// alike. So no socket in this app is opened from a string anywhere else, and a wrong
/// address is a message rather than a crash.
///
/// `ask` is the other half, and it is here for the same reason: a clip and a thumbnail
/// are one question with one frame back, and written twice they were two places that
/// could each open a socket their own way.
enum Relay {
    /// A socket URL for this relay, or nil when the address is not one. `query` says
    /// which kind of connection it is — `?data=1`, `?mode=direct` — appended here so the
    /// check and the appending cannot happen in the wrong order.
    static func url(_ address: String, query: String = "") -> URL? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespaces) + query),
              let scheme = url.scheme?.lowercased(), scheme == "ws" || scheme == "wss",
              url.host?.isEmpty == false else { return nil }
        return url
    }

    /// What to show when it refuses. One sentence in one place, because every screen that
    /// can report it should word it the same way.
    static let badAddress = "Needs a ws:// or wss:// address"

    /// The saved addresses, in the order to try them. One per line in Settings ▸ Server;
    /// commas and spaces split too, since no address contains one. A single address
    /// saved before there was a list is a list of one.
    static func addresses(_ saved: String) -> [String] {
        var seen = Set<String>()
        return (split(saved) + built).filter { seen.insert($0).inserted }
    }

    /// The addresses this build was made with, from app/.relays, tried after the saved
    /// ones — so a fresh install, or one whose saved address is only good at home,
    /// still finds the relay with nothing typed.
    static let built = split(Bundle.main.object(forInfoDictionaryKey: "DuckTalkRelays") as? String ?? "")

    private static func split(_ text: String) -> [String] {
        text.split(whereSeparator: { $0.isNewline || $0 == "," || $0 == " " }).map(String.init)
            .filter { url($0) != nil }
    }

    /// The first address that answers within two seconds, or nil when none does.
    ///
    /// Home Wi-Fi and the tailnet are two doors to one relay, and which one is open
    /// depends on where the phone is — so the phone tries them in order rather than
    /// asking anyone to retype the address on the way out of the door.
    static func resolve(_ addresses: [String]) async -> String? {
        // All at once, first answer wins: off home Wi-Fi the LAN address only ever
        // times out, and nobody should wait those two seconds before the tailnet one.
        await withTaskGroup(of: String?.self) { group in
            for address in addresses { group.addTask { await answers(address) ? address : nil } }
            for await answer in group where answer != nil {
                group.cancelAll()
                return answer
            }
            return nil
        }
    }

    /// A pong means the handshake finished: a relay is there. The timeout is ours,
    /// because a host that drops packets is never refused, only slow.
    private static func answers(_ address: String) async -> Bool {
        guard let url = url(address, query: "?data=1") else { return false }
        let task = URLSession.shared.webSocketTask(with: url)
        task.resume()
        return await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await withCheckedContinuation { done in task.sendPing { done.resume(returning: $0 == nil) } }
            }
            group.addTask { try? await Task.sleep(for: .seconds(2)); return false }
            let answered = await group.next() ?? false
            // Cancelling the socket is what ends a ping still waiting for its pong.
            task.cancel(with: .normalClosure, reason: nil)
            group.cancelAll()
            return answered
        }
    }

    /// Why nothing answered, in one sentence, for the line under the Offline pill. A
    /// tailnet address that is silent while another one failed too is, off home Wi-Fi,
    /// Tailscale switched off on the phone — so that case names it.
    static func offline(_ addresses: [String]) -> String {
        let tailnet = addresses.contains { url($0)?.host?.hasSuffix(".ts.net") == true }
        return tailnet && addresses.count > 1
            ? "Not on home Wi-Fi and the tailnet address does not answer \u{2014} is Tailscale on on this phone?"
            : "No relay answered at any saved address."
    }

    /// Every change of network — Wi-Fi joined or left, Tailscale switched on or off —
    /// and once at the start for the network there is now. Only the newest is kept:
    /// each asks the same question, which address answers now.
    static var pathChanges: AsyncStream<Void> {
        AsyncStream(bufferingPolicy: .bufferingNewest(1)) { changes in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { _ in changes.yield() }
            changes.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: .main)
        }
    }

    /// One socket, one question, one frame back — a clip, or a picture.
    ///
    /// The relay answers media ahead of the state frames every message is answered with,
    /// so the first frame *is* the whole answer: binary is the thing, text means there was
    /// none. Nothing is counted and nothing is waited out. A blob asked for on demand is
    /// not state to be kept in step, which is why this is a function and not a store — a
    /// thumbnail nobody scrolls to costs nothing.
    static func ask(_ address: String, _ question: [String: Any]) async -> Data? {
        guard let url = url(address, query: "?data=1"),
              let json = try? JSONSerialization.data(withJSONObject: question),
              let text = String(data: json, encoding: .utf8) else { return nil }
        let task = URLSession.shared.webSocketTask(with: url)
        task.resume()
        defer { task.cancel(with: .normalClosure, reason: nil) }
        guard (try? await task.send(.string(text))) != nil else { return nil }
        guard case .data(let bytes) = try? await task.receive() else { return nil }
        return bytes
    }
}
