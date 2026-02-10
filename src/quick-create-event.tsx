import {
  Action,
  ActionPanel,
  Form,
  Icon,
  LaunchType,
  Toast,
  getPreferenceValues,
  launchCommand,
  open,
  showToast,
} from "@raycast/api";
import { showFailureToast, useForm } from "@raycast/utils";
import { useGoogleAPIs, withGoogleAPIs } from "./lib/google";
import useCalendars from "./hooks/useCalendars";
import { addSignature } from "./lib/utils";
import { calendar_v3 } from "@googleapis/calendar";
import { useMemo, useState, useCallback } from "react";
import Sherlock from "sherlockjs";

type FormValues = {
  input: string;
  calendar: string;
};

const preferences: Preferences.QuickCreateEvent = getPreferenceValues();

interface SherlockResult {
  eventTitle: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isAllDay: boolean;
}

function parseNaturalLanguage(input: string): SherlockResult {
  return Sherlock.parse(input) as SherlockResult;
}

function formatPreview(parsed: SherlockResult): string {
  if (!parsed.startDate) {
    return "Type something like: 'Meeting with John tomorrow at 3pm' or 'Lunch on Friday from 12-1pm'";
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
  } else if (parsed.endDate) {
    const endStr = parsed.endDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    lines.push(`📅 ${startStr} → ${endStr}`);
  } else {
    const defaultDuration = Number(preferences.defaultEventDuration) || 30;
    const endDate = new Date(parsed.startDate.getTime() + defaultDuration * 60 * 1000);
    const endStr = endDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    lines.push(`📅 ${startStr} → ${endStr} (${defaultDuration}min default)`);
  }

  return lines.join("\n");
}

function Command() {
  const { calendar } = useGoogleAPIs();
  const [calendarId, setCalendarId] = useState("primary");
  const [inputValue, setInputValue] = useState("");
  const [parsed, setParsed] = useState<SherlockResult>({ eventTitle: null, startDate: null, endDate: null, isAllDay: false });

  const { data: calendarsData, isLoading: isLoadingCalendars } = useCalendars();
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

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (value.trim()) {
      const result = parseNaturalLanguage(value);
      setParsed(result);
    } else {
      setParsed({ eventTitle: null, startDate: null, endDate: null, isAllDay: false });
    }
  }, []);

  const { handleSubmit, itemProps } = useForm<FormValues>({
    initialValues: {
      input: "",
      calendar: "primary",
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
      
      // Calculate end date
      let endDate: Date;
      if (result.endDate) {
        endDate = result.endDate;
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
          };

      try {
        const event = await calendar.events.insert({
          calendarId: calendarIdToUse,
          requestBody,
          sendUpdates: preferences.sendInvitations as "all" | "externalOnly" | "none" | undefined,
        });

        setInputValue("");
        setParsed({ eventTitle: null, startDate: null, endDate: null, isAllDay: false });

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
      isLoading={isLoadingCalendars}
      actions={
        <ActionPanel>
          <Action.SubmitForm icon={Icon.Calendar} title="Create Event" onSubmit={handleSubmit} />
          {canOpenFullForm && (
            <Action
              icon={Icon.Pencil}
              title="Open in Full Form"
              shortcut={{ modifiers: ["cmd"], key: "e" }}
              onAction={async () => {
                await launchCommand({
                  name: "create-event",
                  type: LaunchType.UserInitiated,
                  context: {
                    title: parsed.eventTitle,
                    startDate: parsed.startDate,
                    duration: parsed.endDate
                      ? `${Math.round((parsed.endDate.getTime() - parsed.startDate!.getTime()) / 60000)}min`
                      : undefined,
                    calendar: calendarId,
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
        info="Type your event in natural language. Sherlock will parse the date, time, and title."
        {...inputProps}
      />
      <Form.Description title="Preview" text={formatPreview(parsed)} />
      <Form.Dropdown title="Calendar" value={calendarId} {...calendarItemProps}>
        {availableCalendars.map((calendar) => (
          <Form.Dropdown.Item key={calendar.id} value={calendar.id} title={calendar.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

export default withGoogleAPIs(Command);
