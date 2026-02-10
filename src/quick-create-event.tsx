import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Image,
  LaunchType,
  Toast,
  getPreferenceValues,
  launchCommand,
  open,
  showToast,
} from "@raycast/api";
import { getAvatarIcon, showFailureToast, useForm } from "@raycast/utils";
import { useGoogleAPIs, withGoogleAPIs, useContactsList, useContactsSearch } from "./lib/google";
import useCalendars from "./hooks/useCalendars";
import { addSignature } from "./lib/utils";
import { calendar_v3 } from "@googleapis/calendar";
import { useMemo, useState, useCallback } from "react";
import Sherlock from "sherlockjs";
import { people_v1 } from "@googleapis/people";

type FormValues = {
  input: string;
  calendar: string;
  guests: string[];
};

const preferences: Preferences.QuickCreateEvent = getPreferenceValues();

interface SherlockResult {
  eventTitle: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isAllDay: boolean;
}

interface ParsedEvent extends SherlockResult {
  durationMinutes: number | null;
}

// Parse duration patterns like "for 1 hour", "for 30 minutes", "for 2h", etc.
function parseDurationFromText(input: string): { durationMinutes: number | null; cleanedInput: string } {
  const durationPatterns = [
    // "for X hour(s)" or "for X hr(s)"
    /\bfor\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i,
    // "for X minute(s)" or "for X min(s)"
    /\bfor\s+(\d+)\s*(?:minutes?|mins?)\b/i,
    // "for Xh" or "for Xh Ym" or "for X:YY"
    /\bfor\s+(\d+)(?::(\d+)|h(?:\s*(\d+)m?)?)\b/i,
    // "X hour meeting" or "X hr meeting"
    /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s+(?:meeting|call|session|event)\b/i,
    // "X minute meeting"
    /\b(\d+)\s*(?:minutes?|mins?)\s+(?:meeting|call|session|event)\b/i,
  ];

  for (const pattern of durationPatterns) {
    const match = input.match(pattern);
    if (match) {
      let minutes = 0;
      
      if (pattern.source.includes("hour") || pattern.source.includes("hr")) {
        // Hours pattern
        const hours = parseFloat(match[1]);
        minutes = Math.round(hours * 60);
        if (match[2]) {
          // Additional minutes from "Xh Ym" format
          minutes += parseInt(match[2], 10);
        } else if (match[3]) {
          minutes += parseInt(match[3], 10);
        }
      } else if (pattern.source.includes("minute") || pattern.source.includes("min")) {
        // Minutes pattern
        minutes = parseInt(match[1], 10);
      } else if (match[2]) {
        // "X:YY" format
        minutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      }

      if (minutes > 0) {
        // Remove the duration phrase from input so Sherlock doesn't get confused
        const cleanedInput = input.replace(match[0], "").replace(/\s+/g, " ").trim();
        return { durationMinutes: minutes, cleanedInput };
      }
    }
  }

  return { durationMinutes: null, cleanedInput: input };
}

function parseNaturalLanguage(input: string): ParsedEvent {
  // First, extract any explicit duration
  const { durationMinutes, cleanedInput } = parseDurationFromText(input);
  
  // Then parse with Sherlock
  const sherlockResult = Sherlock.parse(cleanedInput) as SherlockResult;
  
  return {
    ...sherlockResult,
    durationMinutes,
  };
}

function formatPreview(parsed: ParsedEvent, selectedGuests: string[]): string {
  if (!parsed.startDate) {
    return "Type something like: 'Meeting with John tomorrow at 3pm for 1 hour' or 'Lunch on Friday from 12-1pm'";
  }

  const lines: string[] = [];
  
  if (parsed.eventTitle) {
    lines.push(`📌 **${parsed.eventTitle}**`);
  }
  
  const startStr = parsed.startDate.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: parsed.isAllDay ? undefined : "numeric",
    minute: parsed.isAllDay ? undefined : "2-digit",
  });
  
  if (parsed.isAllDay) {
    lines.push(`📅 ${startStr} (All day)`);
  } else {
    // Calculate end time
    let endDate: Date;
    let durationNote = "";
    
    if (parsed.endDate) {
      endDate = parsed.endDate;
    } else if (parsed.durationMinutes) {
      endDate = new Date(parsed.startDate.getTime() + parsed.durationMinutes * 60 * 1000);
      durationNote = ` (${formatDuration(parsed.durationMinutes)})`;
    } else {
      const defaultDuration = Number(preferences.defaultEventDuration) || 30;
      endDate = new Date(parsed.startDate.getTime() + defaultDuration * 60 * 1000);
      durationNote = ` (${defaultDuration}min default)`;
    }
    
    const endStr = endDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    lines.push(`📅 ${startStr} → ${endStr}${durationNote}`);
  }

  if (selectedGuests.length > 0) {
    lines.push(`👥 ${selectedGuests.length} guest${selectedGuests.length > 1 ? "s" : ""}`);
  }

  return lines.join("\n");
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

function getContactIcon(contact: people_v1.Schema$Person): Image.ImageLike {
  const profileUrl = contact.photos?.find((photo) => photo.metadata?.source?.type === "PROFILE")?.url;
  if (profileUrl) {
    return {
      source: profileUrl,
      fallback: Icon.Person,
      mask: Image.Mask.Circle,
    };
  }

  const name = contact.names?.[0]?.displayName ?? contact.emailAddresses?.[0]?.value;
  if (name) {
    return getAvatarIcon(name);
  }

  return Icon.Person;
}

function Command() {
  const { calendar } = useGoogleAPIs();
  const [calendarId, setCalendarId] = useState("primary");
  const [inputValue, setInputValue] = useState("");
  const [parsed, setParsed] = useState<ParsedEvent>({ 
    eventTitle: null, 
    startDate: null, 
    endDate: null, 
    isAllDay: false,
    durationMinutes: null 
  });
  const [guestSearch, setGuestSearch] = useState("");
  const [selectedGuests, setSelectedGuests] = useState<string[]>([]);

  const { data: calendarsData, isLoading: isLoadingCalendars } = useCalendars();
  
  // Load initial contacts list, then search when user types
  const { data: initialContacts, isLoading: isLoadingInitialContacts } = useContactsList();
  const { data: searchedContacts, isLoading: isLoadingSearch } = useContactsSearch(guestSearch);
  
  // Combine and deduplicate contacts: search results take priority, then initial contacts
  const contactsData = useMemo(() => {
    const seen = new Set<string>();
    const results: people_v1.Schema$Person[] = [];
    
    // Add search results first (if searching)
    if (guestSearch.trim() && searchedContacts) {
      for (const contact of searchedContacts) {
        const email = contact.emailAddresses?.[0]?.value;
        if (email && !seen.has(email.toLowerCase())) {
          seen.add(email.toLowerCase());
          results.push(contact);
        }
      }
    }
    
    // Add initial contacts (filtered by search query if present)
    if (initialContacts) {
      const query = guestSearch.trim().toLowerCase();
      for (const contact of initialContacts) {
        const email = contact.emailAddresses?.[0]?.value;
        const name = contact.names?.[0]?.displayName?.toLowerCase() ?? "";
        
        if (email && !seen.has(email.toLowerCase())) {
          // If there's a search query, filter by it
          if (!query || name.includes(query) || email.toLowerCase().includes(query)) {
            seen.add(email.toLowerCase());
            results.push(contact);
          }
        }
      }
    }
    
    return results;
  }, [guestSearch, searchedContacts, initialContacts]);
  
  const isLoadingContacts = isLoadingInitialContacts || (guestSearch.trim() ? isLoadingSearch : false);
  
  const availableCalendars = useMemo(() => {
    const available = [...calendarsData.selected, ...calendarsData.unselected].filter(
      (calendar) => calendar.accessRole === "owner",
    );
    const hasOnePrimary = available.filter((calendar) => calendar.primary).length === 1;
    return available.map((calendar) => ({
      id: hasOnePrimary && calendar.primary ? "primary" : calendar.id!,
      title:
        hasOnePrimary && calendar.primary
          ? `Primary${calendar.summary ? ` (${calendar.summary})` : ""}`
          : (calendar.summaryOverride ?? calendar.summary ?? "-- Unknown --"),
    }));
  }, [calendarsData]);

  // Build contact options from search results
  const contactOptions = useMemo(() => {
    if (!contactsData) return [];
    return contactsData
      .filter((contact) => contact.emailAddresses?.[0]?.value)
      .map((contact) => ({
        email: contact.emailAddresses![0]!.value!,
        name: contact.names?.[0]?.displayName,
        icon: getContactIcon(contact),
      }));
  }, [contactsData]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (value.trim()) {
      const result = parseNaturalLanguage(value);
      setParsed(result);
    } else {
      setParsed({ eventTitle: null, startDate: null, endDate: null, isAllDay: false, durationMinutes: null });
    }
  }, []);

  const { handleSubmit, itemProps } = useForm<FormValues>({
    initialValues: {
      input: "",
      calendar: "primary",
      guests: [],
    },
    validation: {
      input: (value) => {
        if (!value?.trim()) return "Please enter an event description";
        const result = parseNaturalLanguage(value);
        if (!result.startDate) return "Could not detect a date/time. Try: 'Meeting tomorrow at 2pm'";
        if (!result.eventTitle) return "Could not detect an event title";
      },
    },
    onSubmit: async (values) => {
      const result = parseNaturalLanguage(values.input);
      
      if (!result.startDate || !result.eventTitle) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not parse event",
          message: "Please include a title and date/time",
        });
        return;
      }

      await showToast({ style: Toast.Style.Animated, title: "Creating event" });

      const calendarIdToUse = values.calendar ?? "primary";
      const startDate = result.startDate;
      
      // Calculate end date with priority: Sherlock endDate > explicit duration > default
      let endDate: Date;
      if (result.endDate) {
        endDate = result.endDate;
      } else if (result.durationMinutes) {
        endDate = new Date(startDate.getTime() + result.durationMinutes * 60 * 1000);
      } else {
        const defaultDuration = Number(preferences.defaultEventDuration) || 30;
        endDate = new Date(startDate.getTime() + defaultDuration * 60 * 1000);
      }

      const requestBody: calendar_v3.Schema$Event = result.isAllDay
        ? {
            summary: result.eventTitle,
            description: addSignature(undefined),
            start: {
              date: startDate.toISOString().split("T")[0],
            },
            end: {
              date: endDate.toISOString().split("T")[0],
            },
            attendees: selectedGuests.length > 0 
              ? selectedGuests.map((email) => ({ email })) 
              : undefined,
          }
        : {
            summary: result.eventTitle,
            description: addSignature(undefined),
            start: {
              dateTime: startDate.toISOString(),
            },
            end: {
              dateTime: endDate.toISOString(),
            },
            attendees: selectedGuests.length > 0 
              ? selectedGuests.map((email) => ({ email })) 
              : undefined,
          };

      try {
        const event = await calendar.events.insert({
          calendarId: calendarIdToUse,
          requestBody,
          sendUpdates: preferences.sendInvitations as "all" | "externalOnly" | "none" | undefined,
        });

        setInputValue("");
        setParsed({ eventTitle: null, startDate: null, endDate: null, isAllDay: false, durationMinutes: null });
        setSelectedGuests([]);

        await showToast({
          title: `Created: ${result.eventTitle}`,
          primaryAction: event.data.htmlLink
            ? {
                title: "Open in Google Calendar",
                shortcut: { modifiers: ["cmd", "shift"], key: "o" },
                onAction: async () => {
                  await open(event.data.htmlLink!);
                },
              }
            : undefined,
          secondaryAction: event.data.id
            ? {
                title: "Delete Event",
                shortcut: { modifiers: ["cmd", "shift"], key: "d" },
                onAction: async (toast) => {
                  await toast.hide();
                  await showToast({ style: Toast.Style.Animated, title: "Deleting event" });
                  try {
                    await calendar.events.delete({ calendarId: calendarIdToUse, eventId: event.data.id! });
                    await showToast({ style: Toast.Style.Success, title: "Deleted event" });
                  } catch (error) {
                    await showFailureToast(error, { title: "Failed deleting event" });
                  }
                },
              }
            : undefined,
        });
      } catch (error) {
        await showFailureToast(error, { title: "Failed to create event" });
      }
    },
  });

  const inputProps = {
    ...itemProps.input,
    value: inputValue,
    onChange: (value: string) => {
      handleInputChange(value);
      itemProps.input.onChange?.(value);
    },
  };

  const calendarItemProps = {
    ...itemProps.calendar,
    onChange: (value: string) => {
      setCalendarId(value);
      itemProps.calendar.onChange?.(value);
    },
  };

  const canOpenFullForm = parsed.startDate && parsed.eventTitle;

  return (
    <Form
      isLoading={isLoadingCalendars || isLoadingContacts}
      actions={
        <ActionPanel>
          <Action.SubmitForm icon={Icon.Calendar} title="Create Event" onSubmit={handleSubmit} />
          {canOpenFullForm && (
            <Action
              icon={Icon.Pencil}
              title="Open in Full Form"
              shortcut={{ modifiers: ["cmd"], key: "e" }}
              onAction={async () => {
                const durationMin = parsed.endDate
                  ? Math.round((parsed.endDate.getTime() - parsed.startDate!.getTime()) / 60000)
                  : parsed.durationMinutes;
                  
                await launchCommand({
                  name: "create-event",
                  type: LaunchType.UserInitiated,
                  context: {
                    title: parsed.eventTitle,
                    startDate: parsed.startDate,
                    duration: durationMin ? `${durationMin}min` : undefined,
                    calendar: calendarId,
                    attendees: selectedGuests.join(","),
                  },
                });
              }}
            />
          )}
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="input"
        title="Event"
        placeholder="Meeting with John tomorrow at 3pm for 1 hour"
        info="Type your event in natural language. Supports: 'tomorrow at 3pm', 'next Friday from 2-4pm', 'for 1 hour', etc."
        {...inputProps}
      />
      <Form.Description title="Preview" text={formatPreview(parsed, selectedGuests)} />
      
      <Form.Separator />
      
      <Form.TagPicker
        id="guests"
        title="Guests"
        placeholder="Search contacts..."
        value={selectedGuests}
        onChange={setSelectedGuests}
        onSearchTextChange={setGuestSearch}
      >
        {contactOptions.map((contact) => (
          <Form.TagPicker.Item
            key={contact.email}
            value={contact.email}
            title={contact.name ? `${contact.name} (${contact.email})` : contact.email}
            icon={contact.icon}
          />
        ))}
      </Form.TagPicker>
      
      <Form.Dropdown title="Calendar" value={calendarId} {...calendarItemProps}>
        {availableCalendars.map((calendar) => (
          <Form.Dropdown.Item key={calendar.id} value={calendar.id} title={calendar.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

export default withGoogleAPIs(Command);
