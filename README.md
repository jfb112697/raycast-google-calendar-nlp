# Google Calendar (Natural Language) for Raycast

Manage your Google calendar with **natural language event creation** powered by [Sherlock](https://github.com/neilgupta/Sherlock).

> **Fork of [raycast/extensions/google-calendar](https://github.com/raycast/extensions/tree/main/extensions/google-calendar)** with added natural language parsing.

## ✨ What's New

### Quick Create Event (Natural Language)

Create events by simply typing what you want in plain English:

- `"Meeting with John tomorrow at 3pm"`
- `"Lunch on Friday from 12-1pm"`
- `"Project review next Monday at 10am for 2 hours"`
- `"Doctor appointment March 15 at 9:30am"`
- `"Team standup every day at 9am"`

Sherlock automatically parses:
- **Event title** - extracted from your text
- **Date & time** - supports relative dates (tomorrow, next week) and absolute dates
- **Duration** - detects time ranges like "3pm to 5pm" or uses your default duration
- **All-day events** - when no time is specified

### Live Preview

As you type, you see a real-time preview of how your event will be created, so you can verify before submitting.

### Seamless Integration

- Press `⌘E` to open the parsed event in the full form editor for additional customization
- All existing commands (List Events, Create Event, Search Contacts) work exactly as before

## Commands

| Command | Description |
|---------|-------------|
| **Quick Create Event** | Create events using natural language |
| Create Event | Traditional form-based event creation |
| List Events | View your upcoming calendar events |
| List Calendars | View and manage your calendars |
| Search Contacts | Search your Google Contacts |

## Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run dev` to start development
4. Or run `npm run build` to build for production

## Examples

Here are some examples of natural language inputs that Sherlock can parse:

| Input | Parsed As |
|-------|-----------|
| `Dentist tomorrow at 2pm` | Tomorrow, 2:00 PM, "Dentist" |
| `Coffee with Sarah on Friday` | Next Friday, all-day, "Coffee with Sarah" |
| `Team meeting next Tuesday from 10am to 11:30am` | Next Tuesday, 10:00-11:30 AM, "Team meeting" |
| `Submit report by end of day` | Today, end of day, "Submit report" |
| `Birthday party on March 15th at 7pm` | March 15, 7:00 PM, "Birthday party" |

## Credits

- Original extension by [Thomas](https://github.com/raycast/extensions/tree/main/extensions/google-calendar)
- Natural language parsing by [Sherlock](https://github.com/neilgupta/Sherlock) by Neil Gupta
- Fork maintained for enhanced natural language support

## License

MIT
