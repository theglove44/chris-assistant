import Foundation
import EventKit

// ---------------------------------------------------------------------------
// chris-calendar: Fast EventKit CLI for chris-assistant bot
// Usage: chris-calendar <command> [args...]
//   list-calendars
//   get-events <calendar> <start-iso> <end-iso>
//   add-event <calendar> <title> <start-iso> <end-iso> [--location X] [--notes X] [--allday]
//   delete-event <calendar> <title>
// Output: JSON to stdout
// ---------------------------------------------------------------------------

let store = EKEventStore()

struct EventOutput: Codable {
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let location: String?
    let notes: String?
    let calendar: String
    let uid: String
}

struct Result: Codable {
    let ok: Bool
    let data: AnyCodable?
    let error: String?
}

// Simple AnyCodable wrapper for JSON output
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let arr = value as? [EventOutput] {
            try container.encode(arr)
        } else if let str = value as? String {
            try container.encode(str)
        } else if let arr = value as? [String] {
            try container.encode(arr)
        } else {
            try container.encode(String(describing: value))
        }
    }

    init(from decoder: Decoder) throws {
        value = try decoder.singleValueContainer().decode(String.self)
    }
}

let isoIn = ISO8601DateFormatter()
isoIn.formatOptions = [.withFullDate, .withTime, .withDashSeparatorInDate, .withColonSeparatorInTime]

let isoOut = ISO8601DateFormatter()
isoOut.formatOptions = [.withInternetDateTime]

func dateFromArg(_ s: String) -> Date? {
    // Try ISO8601 with time
    if let d = isoIn.date(from: s) { return d }
    // Try date-only
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd"
    df.timeZone = TimeZone.current
    if let d = df.date(from: s) { return d }
    // Try "yyyy-MM-dd HH:mm"
    df.dateFormat = "yyyy-MM-dd HH:mm"
    if let d = df.date(from: s) { return d }
    return nil
}

func output(_ result: Any) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(Result(ok: true, data: AnyCodable(result), error: nil)) {
        print(String(data: data, encoding: .utf8)!)
    }
}

func fail(_ msg: String) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(Result(ok: false, data: nil, error: msg)) {
        print(String(data: data, encoding: .utf8)!)
    }
    exit(1)
}

func findCalendar(_ name: String) -> EKCalendar? {
    return store.calendars(for: .event).first { $0.title == name }
}

func requestAccess() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { g, _ in
            granted = g
            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .event) { g, _ in
            granted = g
            semaphore.signal()
        }
    }
    semaphore.wait()
    return granted
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

func listCalendars() {
    let cals = store.calendars(for: .event)
    let names = cals.map { $0.title }
    output(names)
}

func getEvents(calName: String, startStr: String, endStr: String) {
    guard let cal = findCalendar(calName) else {
        fail("Calendar not found: \(calName)")
        return
    }
    guard let start = dateFromArg(startStr) else {
        fail("Invalid start date: \(startStr)")
        return
    }
    guard let end = dateFromArg(endStr) else {
        fail("Invalid end date: \(endStr)")
        return
    }

    let pred = store.predicateForEvents(withStart: start, end: end, calendars: [cal])
    let events = store.events(matching: pred)

    let results = events.map { e in
        EventOutput(
            title: e.title ?? "Untitled",
            start: isoOut.string(from: e.startDate),
            end: isoOut.string(from: e.endDate),
            allDay: e.isAllDay,
            location: e.location,
            notes: e.notes,
            calendar: e.calendar.title,
            uid: e.eventIdentifier
        )
    }
    output(results)
}

func addEvent(calName: String, title: String, startStr: String, endStr: String,
              location: String?, notes: String?, allDay: Bool) {
    guard let cal = findCalendar(calName) else {
        fail("Calendar not found: \(calName)")
        return
    }
    guard let start = dateFromArg(startStr) else {
        fail("Invalid start date: \(startStr)")
        return
    }
    guard let end = dateFromArg(endStr) else {
        fail("Invalid end date: \(endStr)")
        return
    }

    let event = EKEvent(eventStore: store)
    event.title = title
    event.startDate = start
    event.endDate = end
    event.calendar = cal
    event.isAllDay = allDay
    if let loc = location { event.location = loc }
    if let n = notes { event.notes = n }

    do {
        try store.save(event, span: .thisEvent)
        output("Event created: \(title) on \(isoOut.string(from: start))")
    } catch {
        fail("Failed to save event: \(error.localizedDescription)")
    }
}

func deleteEvent(calName: String, title: String) {
    guard let cal = findCalendar(calName) else {
        fail("Calendar not found: \(calName)")
        return
    }

    // Search a wide range for events with this title
    let start = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
    let end = Calendar.current.date(byAdding: .year, value: 2, to: Date())!
    let pred = store.predicateForEvents(withStart: start, end: end, calendars: [cal])
    let events = store.events(matching: pred).filter { $0.title == title }

    if events.isEmpty {
        fail("No matching event found: \(title)")
        return
    }

    var deleted = 0
    for event in events {
        do {
            try store.remove(event, span: .thisEvent)
            deleted += 1
        } catch {
            fail("Failed to delete event: \(error.localizedDescription)")
            return
        }
    }
    output("Deleted \(deleted) event(s) matching: \(title)")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let args = CommandLine.arguments

guard args.count >= 2 else {
    fail("Usage: chris-calendar <command> [args...]")
    exit(1)
}

guard requestAccess() else {
    fail("Calendar access denied. Run this binary once from Terminal.app to grant permission.")
    exit(1)
}

let command = args[1]

switch command {
case "list-calendars":
    listCalendars()

case "get-events":
    guard args.count >= 5 else {
        fail("Usage: chris-calendar get-events <calendar> <start> <end>")
        exit(1)
    }
    getEvents(calName: args[2], startStr: args[3], endStr: args[4])

case "add-event":
    guard args.count >= 6 else {
        fail("Usage: chris-calendar add-event <calendar> <title> <start> <end> [--location X] [--notes X] [--allday]")
        exit(1)
    }
    var location: String?
    var notes: String?
    var allDay = false
    var i = 6
    while i < args.count {
        switch args[i] {
        case "--location":
            i += 1; if i < args.count { location = args[i] }
        case "--notes":
            i += 1; if i < args.count { notes = args[i] }
        case "--allday":
            allDay = true
        default: break
        }
        i += 1
    }
    addEvent(calName: args[2], title: args[3], startStr: args[4], endStr: args[5],
             location: location, notes: notes, allDay: allDay)

case "delete-event":
    guard args.count >= 4 else {
        fail("Usage: chris-calendar delete-event <calendar> <title>")
        exit(1)
    }
    deleteEvent(calName: args[2], title: args[3])

default:
    fail("Unknown command: \(command). Use list-calendars, get-events, add-event, or delete-event.")
}
