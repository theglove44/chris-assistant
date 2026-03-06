import Foundation
import EventKit

// ---------------------------------------------------------------------------
// chris-calendar: Fast EventKit CLI for chris-assistant bot
// Usage: chris-calendar <command> [args...]
//   list-calendars
//   get-events <calendar> <start-iso> <end-iso>
//   add-event <calendar> <title> <start-iso> <end-iso> [--location X] [--notes X] [--allday]
//   update-event <calendar> --uid X [--title X] [--start X] [--end X] [--location X] [--notes X] [--allday] [--clear-location] [--clear-notes]
//   delete-event <calendar> [<title>] [--uid X] [--date YYYY-MM-DD]
//   search-events <query> [--calendar X] [--from X] [--to X] [--max N]
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
    var granted = false
    var done = false
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { g, _ in
            granted = g
            done = true
        }
    } else {
        store.requestAccess(to: .event) { g, _ in
            granted = g
            done = true
        }
    }
    // Spin the run loop so macOS can present the TCC dialog
    while !done {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
    }
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

func deleteEvent(calName: String, title: String?, uid: String?, dateStr: String?) {
    guard let cal = findCalendar(calName) else {
        fail("Calendar not found: \(calName)")
        return
    }

    // UID delete — precise, preferred
    if let uid = uid {
        let start = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
        let end = Calendar.current.date(byAdding: .year, value: 2, to: Date())!
        let pred = store.predicateForEvents(withStart: start, end: end, calendars: [cal])
        let matches = store.events(matching: pred).filter { $0.eventIdentifier == uid }
        if matches.isEmpty {
            fail("No event found for uid: \(uid)")
            return
        }
        do {
            try store.remove(matches[0], span: .thisEvent)
            output("Deleted event (uid: \(uid))")
        } catch {
            fail("Failed to delete event: \(error.localizedDescription)")
        }
        return
    }

    // Title delete — requires date to scope safely
    guard let title = title else {
        fail("delete-event requires --uid or a title + date")
        return
    }
    guard let dateArg = dateStr, let dayStart = dateFromArg(dateArg) else {
        fail("delete-event by title requires a date to scope the search")
        return
    }

    let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!
    let pred = store.predicateForEvents(withStart: dayStart, end: dayEnd, calendars: [cal])
    let matches = store.events(matching: pred).filter { $0.title == title }

    if matches.isEmpty {
        fail("No event named \"\(title)\" found on \(dateArg)")
        return
    }

    // Safety: only delete the first match on that day
    do {
        try store.remove(matches[0], span: .thisEvent)
        output("Deleted event: \(title) on \(dateArg)")
    } catch {
        fail("Failed to delete event: \(error.localizedDescription)")
    }
}

func updateEvent(calName: String, uid: String, title: String?, startStr: String?,
                  endStr: String?, location: String?, notes: String?, allDay: Bool?,
                  clearLocation: Bool, clearNotes: Bool) {
    guard let cal = findCalendar(calName) else {
        fail("Calendar not found: \(calName)")
        return
    }

    // Search 3-year window for the event by UID
    let searchStart = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
    let searchEnd = Calendar.current.date(byAdding: .year, value: 2, to: Date())!
    let pred = store.predicateForEvents(withStart: searchStart, end: searchEnd, calendars: [cal])
    let matches = store.events(matching: pred).filter { $0.eventIdentifier == uid }

    guard let event = matches.first else {
        fail("No event found for uid: \(uid)")
        return
    }

    // Selectively update only provided fields
    if let t = title { event.title = t }
    if let s = startStr {
        guard let d = dateFromArg(s) else { fail("Invalid start date: \(s)"); return }
        event.startDate = d
    }
    if let e = endStr {
        guard let d = dateFromArg(e) else { fail("Invalid end date: \(e)"); return }
        event.endDate = d
    }
    if clearLocation {
        event.location = nil
    } else if let loc = location {
        event.location = loc
    }
    if clearNotes {
        event.notes = nil
    } else if let n = notes {
        event.notes = n
    }
    if let ad = allDay { event.isAllDay = ad }

    do {
        try store.save(event, span: .thisEvent)
        let updated = EventOutput(
            title: event.title ?? "Untitled",
            start: isoOut.string(from: event.startDate),
            end: isoOut.string(from: event.endDate),
            allDay: event.isAllDay,
            location: event.location,
            notes: event.notes,
            calendar: event.calendar.title,
            uid: event.eventIdentifier
        )
        output([updated])
    } catch {
        fail("Failed to update event: \(error.localizedDescription)")
    }
}

func searchEvents(query: String, calName: String?, fromStr: String?, toStr: String?, maxResults: Int) {
    let calendars: [EKCalendar]?
    if let name = calName {
        guard let cal = findCalendar(name) else {
            fail("Calendar not found: \(name)")
            return
        }
        calendars = [cal]
    } else {
        calendars = nil  // Search all calendars
    }

    let start: Date
    if let f = fromStr {
        guard let d = dateFromArg(f) else { fail("Invalid from date: \(f)"); return }
        start = d
    } else {
        // Default: 30 days ago
        start = Calendar.current.date(byAdding: .day, value: -30, to: Date())!
    }

    let end: Date
    if let t = toStr {
        guard let d = dateFromArg(t) else { fail("Invalid to date: \(t)"); return }
        end = d
    } else {
        // Default: 90 days from now
        end = Calendar.current.date(byAdding: .day, value: 90, to: Date())!
    }

    let pred = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let allEvents = store.events(matching: pred)

    let lowerQuery = query.lowercased()
    let matched = allEvents.filter { e in
        let title = (e.title ?? "").lowercased()
        let location = (e.location ?? "").lowercased()
        let notes = (e.notes ?? "").lowercased()
        return title.contains(lowerQuery) || location.contains(lowerQuery) || notes.contains(lowerQuery)
    }

    let capped = Array(matched.prefix(maxResults))
    let results = capped.map { e in
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
    guard args.count >= 3 else {
        fail("Usage: chris-calendar delete-event <calendar> [<title>] [--uid X] [--date YYYY-MM-DD]")
        exit(1)
    }
    var title: String?
    var uid: String?
    var dateStr: String?
    var i = 3

    if args.count >= 4 && !args[3].hasPrefix("--") {
        title = args[3]
        i = 4
    }

    while i < args.count {
        switch args[i] {
        case "--uid":
            i += 1; if i < args.count { uid = args[i] }
        case "--date":
            i += 1; if i < args.count { dateStr = args[i] }
        default: break
        }
        i += 1
    }
    deleteEvent(calName: args[2], title: title, uid: uid, dateStr: dateStr)

case "update-event":
    guard args.count >= 3 else {
        fail("Usage: chris-calendar update-event <calendar> --uid X [--title X] [--start X] [--end X] [--location X] [--notes X] [--allday] [--clear-location] [--clear-notes]")
        exit(1)
    }
    var uUid: String?
    var uTitle: String?
    var uStart: String?
    var uEnd: String?
    var uLocation: String?
    var uNotes: String?
    var uAllDay: Bool?
    var uClearLocation = false
    var uClearNotes = false
    var i = 3
    while i < args.count {
        switch args[i] {
        case "--uid":
            i += 1; if i < args.count { uUid = args[i] }
        case "--title":
            i += 1; if i < args.count { uTitle = args[i] }
        case "--start":
            i += 1; if i < args.count { uStart = args[i] }
        case "--end":
            i += 1; if i < args.count { uEnd = args[i] }
        case "--location":
            i += 1; if i < args.count { uLocation = args[i] }
        case "--notes":
            i += 1; if i < args.count { uNotes = args[i] }
        case "--allday":
            uAllDay = true
        case "--no-allday":
            uAllDay = false
        case "--clear-location":
            uClearLocation = true
        case "--clear-notes":
            uClearNotes = true
        default: break
        }
        i += 1
    }
    guard let uid = uUid else {
        fail("update-event requires --uid")
        exit(1)
    }
    updateEvent(calName: args[2], uid: uid, title: uTitle, startStr: uStart,
                endStr: uEnd, location: uLocation, notes: uNotes, allDay: uAllDay,
                clearLocation: uClearLocation, clearNotes: uClearNotes)

case "search-events":
    guard args.count >= 3 else {
        fail("Usage: chris-calendar search-events <query> [--calendar X] [--from X] [--to X] [--max N]")
        exit(1)
    }
    let sQuery = args[2]
    var sCal: String?
    var sFrom: String?
    var sTo: String?
    var sMax = 20
    var j = 3
    while j < args.count {
        switch args[j] {
        case "--calendar":
            j += 1; if j < args.count { sCal = args[j] }
        case "--from":
            j += 1; if j < args.count { sFrom = args[j] }
        case "--to":
            j += 1; if j < args.count { sTo = args[j] }
        case "--max":
            j += 1; if j < args.count { sMax = Int(args[j]) ?? 20 }
        default: break
        }
        j += 1
    }
    searchEvents(query: sQuery, calName: sCal, fromStr: sFrom, toStr: sTo, maxResults: sMax)

default:
    fail("Unknown command: \(command). Use list-calendars, get-events, add-event, update-event, delete-event, or search-events.")
}
