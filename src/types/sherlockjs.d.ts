declare module "sherlockjs" {
  interface SherlockResult {
    eventTitle: string | null;
    startDate: Date | null;
    endDate: Date | null;
    isAllDay: boolean;
  }

  interface Sherlock {
    parse(input: string): SherlockResult;
    _setNow(date: Date | null): void;
  }

  const sherlock: Sherlock;
  export default sherlock;
}
