import WidgetKit
import SwiftUI

// Matches the JSON the app writes to the App Group (widgets/widget-data.ts).
struct HabitData: Codable {
    var doneToday: Int = 0
    var totalToday: Int = 0
    var bestStreak: Int = 0
    var dateLabel: String = ""
}

func loadHabitData() -> HabitData {
    guard let defaults = UserDefaults(suiteName: "group.com.habitmind.app"),
          let raw = defaults.string(forKey: "habitai.widget.v1"),
          let data = raw.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(HabitData.self, from: data)
    else { return HabitData() }
    return decoded
}

struct HabitEntry: TimelineEntry {
    let date: Date
    let data: HabitData
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> HabitEntry {
        HabitEntry(date: Date(), data: HabitData(doneToday: 2, totalToday: 5, bestStreak: 7, dateLabel: "Today"))
    }

    func getSnapshot(in context: Context, completion: @escaping (HabitEntry) -> Void) {
        completion(HabitEntry(date: Date(), data: loadHabitData()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitEntry>) -> Void) {
        let entry = HabitEntry(date: Date(), data: loadHabitData())
        // Refresh roughly every 30 minutes; the app also reloads the widget on each check-in.
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct HabitWidgetEntryView: View {
    var entry: HabitEntry

    private let accent = Color(red: 0.725, green: 0.663, blue: 1.0)
    private let muted = Color(red: 0.545, green: 0.514, blue: 0.651)
    private let subtle = Color(red: 0.667, green: 0.643, blue: 0.718)
    private let green = Color(red: 0.341, green: 0.725, blue: 0.569)
    private let flame = Color(red: 0.878, green: 0.482, blue: 0.122)
    private let background = Color(red: 0.114, green: 0.102, blue: 0.141)

    var body: some View {
        let data = entry.data
        let allDone = data.totalToday > 0 && data.doneToday >= data.totalToday
        let headline = data.totalToday == 0 ? "No habits today" : "\(data.doneToday) / \(data.totalToday) done"
        let subtitle = data.totalToday == 0 ? "Add a habit to get started" : (allDone ? "All done — nice work!" : "Tap to check in your habits")

        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("HabitAI").font(.system(size: 13, weight: .semibold)).foregroundColor(accent)
                Spacer()
                Text(data.dateLabel).font(.system(size: 11)).foregroundColor(muted)
            }
            Spacer(minLength: 2)
            Text(headline).font(.system(size: 24, weight: .bold)).foregroundColor(allDone ? green : .white)
            Text(subtitle).font(.system(size: 11)).foregroundColor(subtle)
            Spacer(minLength: 2)
            Text("🔥 \(data.bestStreak)-day streak").font(.system(size: 12)).foregroundColor(flame)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetBackgroundCompat(background)
    }
}

extension View {
    // containerBackground is required on iOS 17+; fall back to a plain background below it.
    @ViewBuilder
    func widgetBackgroundCompat(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }
}

struct HabitWidget: Widget {
    let kind = "HabitWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            HabitWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("HabitAI Progress")
        .description("Today's habit progress and your best streak.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct ExportWidgets: WidgetBundle {
    var body: some Widget {
        HabitWidget()
    }
}
