import Foundation
import EventKit

// ---------------------------------------------------------------------------
// chris-reminders: Fast EventKit CLI for chris-assistant bot
// Usage: chris-reminders <command> [args...]
//   list-lists
//   get-reminders <list> [--include-completed] [--count N]
//   create-reminder <list> <title> [--due-date X] [--due-time X] [--priority high|medium|low|none] [--notes X]
//   update-reminder <list> <title> [--new-title X] [--due-date X] [--due-time X] [--priority X] [--notes X] [--clear-due-date]
//   complete-reminder <list> <title>
//   search-reminders <query> [--list X] [--include-completed] [--count N]
// Output: JSON to stdout
// ---------------------------------------------------------------------------

let store = EKEventStore()

struct ReminderOutput: Codable {
    let title: String
    let completed: Bool
    let priority: String
    let dueDate: String?
    let notes: String?
    let list: String
}

struct Result: Codable {
    let ok: Bool
    let data: AnyCodable?
    let error: String?
}

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let arr = value as? [ReminderOutput] {
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

func priorityLabel(_ p: Int) -> String {
    switch p {
    case 1...4: return "high"
    case 5: return "medium"
    case 6...9: return "low"
    default: return "none"
    }
}

func priorityValue(_ label: String) -> Int {
    switch label.lowercased() {
    case "high": return 1
    case "medium": return 5
    case "low": return 9
    default: return 0
    }
}

func requestAccess() -> Bool {
    var granted = false
    var done = false
    if #available(macOS 14.0, *) {
        store.requestFullAccessToReminders { g, _ in
            granted = g
            done = true
        }
    } else {
        store.requestAccess(to: .reminder) { g, _ in
            granted = g
            done = true
        }
    }
    while !done {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
    }
    return granted
}

func findList(_ name: String) -> EKCalendar? {
    return store.calendars(for: .reminder).first { $0.title == name }
}

func reminderToOutput(_ r: EKReminder) -> ReminderOutput {
    var dueDateStr: String? = nil
    if let comps = r.dueDateComponents, let date = Calendar.current.date(from: comps) {
        let df = DateFormatter()
        if comps.hour != nil {
            df.dateFormat = "yyyy-MM-dd HH:mm"
        } else {
            df.dateFormat = "yyyy-MM-dd"
        }
        dueDateStr = df.string(from: date)
    }
    return ReminderOutput(
        title: r.title ?? "Untitled",
        completed: r.isCompleted,
        priority: priorityLabel(Int(r.priority)),
        dueDate: dueDateStr,
        notes: r.notes,
        list: r.calendar.title
    )
}

// ---------------------------------------------------------------------------
// Fetch helpers — EventKit reminder fetches are async
// ---------------------------------------------------------------------------

func fetchReminders(matching predicate: NSPredicate) -> [EKReminder] {
    var results: [EKReminder]? = nil
    var done = false
    store.fetchReminders(matching: predicate) { reminders in
        results = reminders
        done = true
    }
    while !done {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
    }
    return results ?? []
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

func listLists() {
    let cals = store.calendars(for: .reminder)
    let names = cals.map { $0.title }
    output(names)
}

func getReminders(listName: String, includeCompleted: Bool, count: Int) {
    guard let cal = findList(listName) else {
        fail("Reminder list not found: \(listName)")
        return
    }

    let predicate: NSPredicate
    if includeCompleted {
        predicate = store.predicateForReminders(in: [cal])
    } else {
        predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [cal])
    }

    let reminders = fetchReminders(matching: predicate)
    let capped = Array(reminders.prefix(count))
    let results = capped.map { reminderToOutput($0) }
    output(results)
}

func createReminder(listName: String, title: String, dueDateStr: String?, dueTimeStr: String?,
                    priority: String?, notes: String?) {
    guard let cal = findList(listName) else {
        fail("Reminder list not found: \(listName)")
        return
    }

    let reminder = EKReminder(eventStore: store)
    reminder.title = title
    reminder.calendar = cal

    if let p = priority {
        reminder.priority = Int(priorityValue(p))
    }
    if let n = notes {
        reminder.notes = n
    }
    if let dateStr = dueDateStr {
        let df = DateFormatter()
        df.timeZone = TimeZone.current
        var comps: DateComponents
        if let timeStr = dueTimeStr {
            df.dateFormat = "yyyy-MM-dd HH:mm"
            if let date = df.date(from: "\(dateStr) \(timeStr)") {
                comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            } else {
                fail("Invalid date/time: \(dateStr) \(timeStr)")
                return
            }
        } else {
            df.dateFormat = "yyyy-MM-dd"
            if let date = df.date(from: dateStr) {
                comps = Calendar.current.dateComponents([.year, .month, .day], from: date)
            } else {
                fail("Invalid date: \(dateStr)")
                return
            }
        }
        reminder.dueDateComponents = comps
    }

    do {
        try store.save(reminder, commit: true)
        output("Created reminder: \(title) in list: \(listName)")
    } catch {
        fail("Failed to save reminder: \(error.localizedDescription)")
    }
}

func updateReminder(listName: String, title: String, newTitle: String?, dueDateStr: String?,
                    dueTimeStr: String?, priority: String?, notes: String?, clearDueDate: Bool) {
    guard let cal = findList(listName) else {
        fail("Reminder list not found: \(listName)")
        return
    }

    let predicate = store.predicateForReminders(in: [cal])
    let reminders = fetchReminders(matching: predicate)
    guard let reminder = reminders.first(where: { $0.title == title }) else {
        fail("No reminder found named \"\(title)\" in list: \(listName)")
        return
    }

    if let t = newTitle { reminder.title = t }
    if let p = priority { reminder.priority = Int(priorityValue(p)) }
    if let n = notes { reminder.notes = n }

    if clearDueDate {
        reminder.dueDateComponents = nil
    } else if let dateStr = dueDateStr {
        let df = DateFormatter()
        df.timeZone = TimeZone.current
        if let timeStr = dueTimeStr {
            df.dateFormat = "yyyy-MM-dd HH:mm"
            if let date = df.date(from: "\(dateStr) \(timeStr)") {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            } else {
                fail("Invalid date/time: \(dateStr) \(timeStr)")
                return
            }
        } else {
            df.dateFormat = "yyyy-MM-dd"
            if let date = df.date(from: dateStr) {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: date)
            } else {
                fail("Invalid date: \(dateStr)")
                return
            }
        }
    }

    do {
        try store.save(reminder, commit: true)
        output("Updated reminder: \(reminder.title ?? title)")
    } catch {
        fail("Failed to update reminder: \(error.localizedDescription)")
    }
}

func completeReminder(listName: String, title: String) {
    guard let cal = findList(listName) else {
        fail("Reminder list not found: \(listName)")
        return
    }

    let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [cal])
    let reminders = fetchReminders(matching: predicate)
    guard let reminder = reminders.first(where: { $0.title == title }) else {
        fail("No incomplete reminder found named \"\(title)\" in list: \(listName)")
        return
    }

    reminder.isCompleted = true
    reminder.completionDate = Date()

    do {
        try store.save(reminder, commit: true)
        output("Completed reminder: \(title)")
    } catch {
        fail("Failed to complete reminder: \(error.localizedDescription)")
    }
}

func searchReminders(query: String, listName: String?, includeCompleted: Bool, count: Int) {
    let calendars: [EKCalendar]?
    if let name = listName {
        guard let cal = findList(name) else {
            fail("Reminder list not found: \(name)")
            return
        }
        calendars = [cal]
    } else {
        calendars = nil
    }

    let predicate: NSPredicate
    if includeCompleted {
        predicate = store.predicateForReminders(in: calendars)
    } else {
        predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
    }

    let reminders = fetchReminders(matching: predicate)
    let lowerQuery = query.lowercased()
    let matched = reminders.filter { r in
        let title = (r.title ?? "").lowercased()
        let notes = (r.notes ?? "").lowercased()
        return title.contains(lowerQuery) || notes.contains(lowerQuery)
    }

    let capped = Array(matched.prefix(count))
    let results = capped.map { reminderToOutput($0) }
    output(results)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let args = CommandLine.arguments

guard args.count >= 2 else {
    fail("Usage: chris-reminders <command> [args...]")
    exit(1)
}

guard requestAccess() else {
    fail("Reminders access denied. Run this binary once from Terminal.app to grant permission.")
    exit(1)
}

let command = args[1]

switch command {
case "list-lists":
    listLists()

case "get-reminders":
    guard args.count >= 3 else {
        fail("Usage: chris-reminders get-reminders <list> [--include-completed] [--count N]")
        exit(1)
    }
    var includeCompleted = false
    var count = 50
    var i = 3
    while i < args.count {
        switch args[i] {
        case "--include-completed":
            includeCompleted = true
        case "--count":
            i += 1; if i < args.count { count = Int(args[i]) ?? 50 }
        default: break
        }
        i += 1
    }
    getReminders(listName: args[2], includeCompleted: includeCompleted, count: count)

case "create-reminder":
    guard args.count >= 4 else {
        fail("Usage: chris-reminders create-reminder <list> <title> [--due-date X] [--due-time X] [--priority X] [--notes X]")
        exit(1)
    }
    var dueDate: String?
    var dueTime: String?
    var priority: String?
    var notes: String?
    var i = 4
    while i < args.count {
        switch args[i] {
        case "--due-date":
            i += 1; if i < args.count { dueDate = args[i] }
        case "--due-time":
            i += 1; if i < args.count { dueTime = args[i] }
        case "--priority":
            i += 1; if i < args.count { priority = args[i] }
        case "--notes":
            i += 1; if i < args.count { notes = args[i] }
        default: break
        }
        i += 1
    }
    createReminder(listName: args[2], title: args[3], dueDateStr: dueDate, dueTimeStr: dueTime,
                   priority: priority, notes: notes)

case "update-reminder":
    guard args.count >= 4 else {
        fail("Usage: chris-reminders update-reminder <list> <title> [--new-title X] [--due-date X] [--due-time X] [--priority X] [--notes X] [--clear-due-date]")
        exit(1)
    }
    var newTitle: String?
    var dueDate: String?
    var dueTime: String?
    var priority: String?
    var notes: String?
    var clearDueDate = false
    var i = 4
    while i < args.count {
        switch args[i] {
        case "--new-title":
            i += 1; if i < args.count { newTitle = args[i] }
        case "--due-date":
            i += 1; if i < args.count { dueDate = args[i] }
        case "--due-time":
            i += 1; if i < args.count { dueTime = args[i] }
        case "--priority":
            i += 1; if i < args.count { priority = args[i] }
        case "--notes":
            i += 1; if i < args.count { notes = args[i] }
        case "--clear-due-date":
            clearDueDate = true
        default: break
        }
        i += 1
    }
    updateReminder(listName: args[2], title: args[3], newTitle: newTitle, dueDateStr: dueDate,
                   dueTimeStr: dueTime, priority: priority, notes: notes, clearDueDate: clearDueDate)

case "complete-reminder":
    guard args.count >= 4 else {
        fail("Usage: chris-reminders complete-reminder <list> <title>")
        exit(1)
    }
    completeReminder(listName: args[2], title: args[3])

case "search-reminders":
    guard args.count >= 3 else {
        fail("Usage: chris-reminders search-reminders <query> [--list X] [--include-completed] [--count N]")
        exit(1)
    }
    var listName: String?
    var includeCompleted = false
    var count = 50
    var i = 3
    while i < args.count {
        switch args[i] {
        case "--list":
            i += 1; if i < args.count { listName = args[i] }
        case "--include-completed":
            includeCompleted = true
        case "--count":
            i += 1; if i < args.count { count = Int(args[i]) ?? 50 }
        default: break
        }
        i += 1
    }
    searchReminders(query: args[2], listName: listName, includeCompleted: includeCompleted, count: count)

default:
    fail("Unknown command: \(command). Use list-lists, get-reminders, create-reminder, update-reminder, complete-reminder, or search-reminders.")
}
